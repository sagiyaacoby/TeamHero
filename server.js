const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const net = require('net');

const BASE = path.join(__dirname, 'portal');
const ROOT = __dirname;

function getConfiguredPort() {
  try {
    var sys = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/system.json'), 'utf8'));
    if (sys.port) return sys.port;
  } catch(e) {}
  return null;
}

function savePort(port) {
  var sp = path.join(ROOT, 'config/system.json');
  var sys = {};
  try { sys = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch(e) {}
  sys.port = port;
  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(sys, null, 2) + '\n');
}

function isPortFree(port) {
  return new Promise(function(resolve) {
    var srv = net.createServer();
    srv.once('error', function() { resolve(false); });
    srv.once('listening', function() { srv.close(function() { resolve(true); }); });
    srv.listen(port);
  });
}

async function findFreePort(start) {
  for (var p = start; p < start + 100; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('No free port found in range ' + start + '-' + (start + 99));
}

var PORT; // assigned during startup

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/plain',
};

function safePath(rel) {
  const resolved = path.resolve(ROOT, rel);
  return resolved.startsWith(ROOT) ? resolved : null;
}

function writeSafePath(rel) {
  const resolved = safePath(rel);
  if (!resolved) return null;
  const relNorm = path.relative(ROOT, resolved).replace(/\\/g, '/');
  if (relNorm.startsWith('portal/') || relNorm === 'portal' || relNorm === 'server.js') return null;
  return resolved;
}

function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch(e) { return null; } }
function writeJSON(fp, d) { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, JSON.stringify(d, null, 2) + '\n'); }
function readText(fp) { try { return fs.readFileSync(fp, 'utf8'); } catch(e) { return null; } }
function writeText(fp, c) { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, c); }

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    let body = '';
    req.on('data', function(ch) { body += ch; if (body.length > 5e6) { req.destroy(); reject(new Error('Too large')); } });
    req.on('end', function() { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
  });
}

function J(res, data, s) { s=s||200; res.writeHead(s, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); }
function E(res, msg, s) { J(res, {error:msg}, s||400); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

// ── WebSocket Client Tracking + Broadcast ────────────────
var wsClients = new Set();

function broadcast(scope) {
  var msg = JSON.stringify({ type: 'refresh', scope: scope });
  var frame = buildWsFrame(msg);
  wsClients.forEach(function(socket) {
    try { socket.write(frame); } catch(e) {}
  });
}

// ── Orchestrator Auto-Create ────────────────────────────
function ensureOrchestrator() {
  var rp = path.join(ROOT, 'agents/_registry.json');
  var rg = readJSON(rp) || { agents: [] };
  var hasOrch = rg.agents.some(function(a) { return a.isOrchestrator; });
  if (hasOrch) return;

  var id = 'orchestrator';
  var dir = path.join(ROOT, 'agents', id);
  fs.mkdirSync(dir, { recursive: true });

  var a = {
    id: id,
    name: 'Orchestrator',
    role: 'Team Orchestrator',
    mission: 'Coordinate all sub-agents, manage tasks, run round tables, and serve as central command.',
    description: 'The orchestrator manages the entire agent team, delegates tasks, runs structured review sessions, and ensures all agents work cohesively toward the owner goals.',
    personality: { traits: ['strategic','organized','decisive'], tone: 'professional and efficient', style: 'clear, structured, action-oriented' },
    rules: ['Check agent memory before delegating', 'Update agent short-memory after tasks', 'Never bypass task lifecycle', 'Present items needing approval first'],
    capabilities: ['task-management','agent-coordination','round-table','context-synthesis'],
    status: 'active',
    isOrchestrator: true,
    createdAt: new Date().toISOString()
  };

  writeJSON(path.join(dir, 'agent.json'), a);
  rebuildAgentMd(id, a);
  writeText(path.join(dir, 'short-memory.md'), '');
  writeText(path.join(dir, 'long-memory.md'), '');
  writeText(path.join(dir, 'rules.md'), a.rules.map(function(r) { return '- ' + r; }).join('\n') + '\n');

  rg.agents.unshift({ id: id, name: a.name, role: a.role, status: a.status, isOrchestrator: true });
  writeJSON(rp, rg);
  rebuildClaudeMd();
  console.log('  Orchestrator agent created.');
}

// ── CLAUDE.md Generation ─────────────────────────────────
function rebuildClaudeMd() {
  const sys = readJSON(path.join(ROOT, 'config/system.json')) || {};
  const reg = readJSON(path.join(ROOT, 'agents/_registry.json')) || { agents: [] };
  const ownerMd = readText(path.join(ROOT, 'profile/owner.md')) || '';
  const teamR = readText(path.join(ROOT, 'config/team-rules.md')) || '';
  const secR = readText(path.join(ROOT, 'config/security-rules.md')) || '';
  const tn = sys.teamName || 'Multi-Agent Team';

  var orchAgents = reg.agents.filter(function(a) { return a.isOrchestrator; });
  var subAgents = reg.agents.filter(function(a) { return !a.isOrchestrator; });

  var al = '';
  if (orchAgents.length > 0) {
    al += orchAgents.map(function(a) {
      return '- **' + a.name + '** (' + a.role + ') \u2014 ID: `' + a.id + '` \u2192 `agents/' + a.id + '/agent.md` [ORCHESTRATOR]';
    }).join('\n') + '\n';
  }
  if (subAgents.length > 0) {
    al += subAgents.map(function(a) {
      return '- **' + a.name + '** (' + a.role + ') \u2014 ID: `' + a.id + '` \u2192 `agents/' + a.id + '/agent.md`';
    }).join('\n');
  }

  var port = PORT;

  const md = '# ' + tn + ' \u2014 Orchestrator Context\n\n' +
    '> **Auto-generated file.** Do not edit manually. Regenerated when config changes.\n\n' +
    '## Identity\n\n' +
    'You are the **orchestrator** of the "' + tn + '" team.\n' +
    'Your job is to coordinate all agents, manage tasks, run round tables, and serve the team owner.\n\n' +
    '## Owner Profile\n\n' + (ownerMd || '_No owner profile configured yet._') + '\n\n' +
    '## Active Agents\n\n' + (al || '_No agents registered yet._') + '\n\n' +
    '### How to Work as an Agent\n\n' +
    'When the owner asks you to perform work that matches a specific agent\'s role:\n' +
    '1. Read that agent\'s definition: `agents/{id}/agent.md`\n' +
    '2. Read their memory files: `agents/{id}/short-memory.md` and `agents/{id}/long-memory.md`\n' +
    '3. Adopt the agent\'s personality, tone, and style\n' +
    '4. Follow the agent\'s specific rules\n' +
    '5. After completing work, update the agent\'s short-memory with what was done\n' +
    '6. For important learned patterns, update long-memory\n\n' +
    '## System API\n\n' +
    'IMPORTANT: When creating agents, tasks, or updating data, you MUST use these API endpoints.\n' +
    'The dashboard portal reads from these same endpoints. Using the API keeps everything in sync.\n' +
    'The server runs at `http://localhost:' + port + '`.\n\n' +
    '### Agents\n' +
    '- **List agents:** `GET /api/agents`\n' +
    '- **Get agent:** `GET /api/agents/{id}`\n' +
    '- **Create agent:** `POST /api/agents` with JSON body `{"name","role","mission","description","personality":{"traits":[],"tone","style"},"rules":[],"capabilities":[]}`\n' +
    '- **Update agent:** `PUT /api/agents/{id}` with JSON body (partial update)\n' +
    '- **Delete agent:** `DELETE /api/agents/{id}` (orchestrator cannot be deleted)\n' +
    '- **Get memory:** `GET /api/agents/{id}/memory/short` or `/long`\n' +
    '- **Update memory:** `PUT /api/agents/{id}/memory/short` or `/long` with `{"content":"..."}`\n\n' +
    '### Tasks\n' +
    '- **List tasks:** `GET /api/tasks`\n' +
    '- **Get task:** `GET /api/tasks/{id}`\n' +
    '- **Create task:** `POST /api/tasks` with `{"title","description","assignedTo","status":"draft","priority":"medium"}`\n' +
    '- **Update task:** `PUT /api/tasks/{id}` with JSON body (partial update, e.g. `{"status":"done"}`)\n\n' +
    '### Other\n' +
    '- **Update profile:** `PUT /api/profile` with owner JSON\n' +
    '- **Update rules:** `PUT /api/rules/team` or `/security` with `{"content":"..."}`\n' +
    '- **Rebuild CLAUDE.md:** `POST /api/rebuild-context`\n' +
    '- **Write file:** `POST /api/write-file` with `{"path":"...","content":"..."}`\n\n' +
    'Use `curl` to call these endpoints. Example:\n' +
    '```bash\n' +
    'curl -X POST http://localhost:' + port + '/api/agents -H "Content-Type: application/json" -d \'{"name":"Writer","role":"Content Writer","mission":"Create engaging content"}\'\n' +
    '```\n\n' +
    'After any API call that modifies data, the dashboard automatically refreshes in real-time.\n\n' +
    '## Team Building\n\n' +
    'When the owner asks you to "build a team", "add agents", or "create a team":\n' +
    '1. Ask clarifying questions about what roles are needed if not specified\n' +
    '2. Create each agent via the API with a distinct role, personality, and mission\n' +
    '3. Each agent should have specific rules and capabilities relevant to their role\n\n' +
    'To create an agent via API:\n' +
    '```bash\n' +
    'curl -X POST http://localhost:' + port + '/api/agents \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"name":"Agent Name","role":"Role Title","mission":"What this agent does","description":"Detailed description","personality":{"traits":["trait1","trait2"],"tone":"tone description","style":"style description"},"rules":["rule1","rule2"],"capabilities":["cap1","cap2"]}\'\n' +
    '```\n\n' +
    'Rules for team building:\n' +
    '- Always use the API to create agents — never write agent files directly\n' +
    '- Give each agent a distinct role that doesn\'t overlap with others\n' +
    '- Set personality traits, tone, and style to differentiate agents\n' +
    '- Include specific rules for each agent\'s domain\n' +
    '- After creating agents, briefly summarize the team to the owner\n\n' +
    '## Team Rules\n\n' + teamR + '\n\n' +
    '## Security Rules\n\n' + secR + '\n\n' +
    '## Round Table Protocol\n\n' +
    'A "round table" is a structured review session. When asked to run one:\n' +
    '1. Scan all tasks in `data/tasks/` \u2014 review each task\'s status\n' +
    '2. For each agent, summarize what they\'ve accomplished and what\'s pending\n' +
    '3. Present items needing approval to the owner\n' +
    '4. Create a round table summary in `data/round-tables/` with timestamp filename\n' +
    '5. Update each agent\'s short-memory with round table outcomes\n' +
    '6. Clear completed items from short-memory\n\n' +
    '## Task Lifecycle\n\n' +
    'Tasks flow through: `draft` \u2192 `in_progress` \u2192 `pending_approval` \u2192 `approved` / `revision_needed` \u2192 `done`\n\n' +
    'Task files: `data/tasks/{task-id}/task.json` with version folders `v1/`, `v2/`, etc.\n\n' +
    '## File Structure Reference\n\n' +
    '- `config/system.json` \u2014 System configuration\n' +
    '- `config/team-rules.md` \u2014 Team operational rules\n' +
    '- `config/security-rules.md` \u2014 Security guidelines\n' +
    '- `profile/owner.json` / `owner.md` \u2014 Owner profile\n' +
    '- `agents/_registry.json` \u2014 Agent registry\n' +
    '- `agents/{id}/` \u2014 Individual agent folders\n' +
    '- `data/tasks/` \u2014 All tasks\n' +
    '- `data/round-tables/` \u2014 Round table summaries\n' +
    '- `data/media/` \u2014 Shared media library\n';

  writeText(path.join(ROOT, 'CLAUDE.md'), md);
  return md;
}

function rebuildOwnerMd(p) {
  const l = ['# Owner Profile\n'];
  if (p.name) l.push('**Name:** ' + p.name);
  if (p.role) l.push('**Role:** ' + p.role);
  if (p.expertise) l.push('**Expertise:** ' + p.expertise);
  if (p.goals) l.push('\n## Goals\n' + p.goals);
  if (p.targetAudience) l.push('\n## Target Audience\n' + p.targetAudience);
  if (p.brandVoice) l.push('\n## Brand Voice\n' + p.brandVoice);
  if (p.communicationStyle) l.push('\n## Communication Style\n' + p.communicationStyle);
  writeText(path.join(ROOT, 'profile/owner.md'), l.join('\n') + '\n');
}

function rebuildAgentMd(aid, a) {
  const p = a.personality || {};
  const md = '# ' + a.name + '\n\n' +
    '**Role:** ' + (a.role || 'Agent') + '\n' +
    '**Status:** ' + (a.status || 'active') + '\n\n' +
    '## Mission\n' + (a.mission || '_No mission defined._') + '\n\n' +
    '## Description\n' + (a.description || '_No description._') + '\n\n' +
    '## Personality\n' +
    '- **Traits:** ' + ((p.traits||[]).join(', ') || 'not specified') + '\n' +
    '- **Tone:** ' + (p.tone || 'not specified') + '\n' +
    '- **Style:** ' + (p.style || 'not specified') + '\n\n' +
    '## Rules\n' + ((a.rules||[]).map(function(r){return '- '+r;}).join('\n') || '_No specific rules._') + '\n\n' +
    '## Capabilities\n' + ((a.capabilities||[]).join(', ') || '_No capabilities defined._') + '\n\n' +
    '## Memory\n' +
    '- Short-term context: `agents/' + aid + '/short-memory.md`\n' +
    '- Long-term knowledge: `agents/' + aid + '/long-memory.md`\n' +
    '- Agent-specific rules: `agents/' + aid + '/rules.md`\n';
  writeText(path.join(ROOT, 'agents', aid, 'agent.md'), md);
}

// ── WebSocket Helpers ────────────────────────────────────
function parseWsFrame(buf) {
  if (buf.length < 2) return null;
  var b0 = buf[0], b1 = buf[1];
  var opcode = b0 & 0x0f;
  var masked = (b1 & 0x80) !== 0;
  var len = b1 & 0x7f;
  var offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  var maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;
  var payload = Buffer.from(buf.slice(offset, offset + len));
  if (masked && maskKey) {
    for (var i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }

  return { opcode: opcode, payload: payload, totalLen: offset + len };
}

function buildWsFrame(data) {
  var payload = Buffer.from(data, 'utf8');
  var len = payload.length;
  var header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, obj) {
  try { socket.write(buildWsFrame(JSON.stringify(obj))); } catch(e) {}
}

// ── Claude CLI Spawner ───────────────────────────────────
var activeProcesses = new Map();

function spawnClaude(message, socket) {
  var existing = activeProcesses.get(socket);
  if (existing) { try { existing.kill(); } catch(e) {} }

  var args = ['-p', message, '--output-format', 'stream-json', '--verbose'];
  var proc = spawn('claude', args, {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { FORCE_COLOR: '0' })
  });

  activeProcesses.set(socket, proc);

  var lineBuf = '';
  proc.stdout.on('data', function(chunk) {
    lineBuf += chunk.toString();
    var lines = lineBuf.split('\n');
    lineBuf = lines.pop();
    lines.forEach(function(line) {
      line = line.trim();
      if (!line) return;
      try {
        var evt = JSON.parse(line);
        wsSend(socket, { type: 'claude-event', event: evt });
      } catch(e) {
        wsSend(socket, { type: 'claude-event', event: { type: 'raw', text: line } });
      }
    });
  });

  proc.stderr.on('data', function(chunk) {
    var text = chunk.toString().trim();
    if (text) wsSend(socket, { type: 'claude-error', error: text });
  });

  proc.on('close', function(code) {
    if (lineBuf.trim()) {
      try {
        var evt = JSON.parse(lineBuf.trim());
        wsSend(socket, { type: 'claude-event', event: evt });
      } catch(e) {
        wsSend(socket, { type: 'claude-event', event: { type: 'raw', text: lineBuf.trim() } });
      }
    }
    activeProcesses.delete(socket);
    wsSend(socket, { type: 'claude-done', code: code });
    // Claude may have modified files via API — broadcast refresh for all scopes
    broadcast('all');
  });

  proc.on('error', function(err) {
    activeProcesses.delete(socket);
    wsSend(socket, { type: 'claude-error', error: 'Failed to start Claude CLI: ' + err.message });
    wsSend(socket, { type: 'claude-done', code: -1 });
  });
}

// ── Request Handler ──────────────────────────────────────
async function handle(pn, m, req, res) {
  // SYSTEM
  if (pn === '/api/system/status' && m === 'GET')
    return J(res, readJSON(path.join(ROOT, 'config/system.json')) || { initialized: false });
  if (pn === '/api/system/initialize' && m === 'POST') {
    const sp = path.join(ROOT, 'config/system.json');
    const s = readJSON(sp) || {};
    s.initialized = true;
    writeJSON(sp, s);
    ensureOrchestrator();
    rebuildClaudeMd();
    broadcast('all');
    return J(res, { ok: true });
  }
  if (pn === '/api/rebuild-context' && m === 'POST') {
    rebuildClaudeMd();
    return J(res, { ok: true });
  }

  // PROFILE
  if (pn === '/api/profile' && m === 'GET')
    return J(res, readJSON(path.join(ROOT, 'profile/owner.json')) || {});
  if (pn === '/api/profile' && m === 'PUT') {
    const b = await parseBody(req);
    writeJSON(path.join(ROOT, 'profile/owner.json'), b);
    rebuildOwnerMd(b);
    rebuildClaudeMd();
    broadcast('profile');
    return J(res, { ok: true });
  }

  // AGENTS
  if (pn === '/api/agents' && m === 'GET')
    return J(res, readJSON(path.join(ROOT, 'agents/_registry.json')) || { agents: [] });

  const amm = pn.match(/^\/api\/agents\/([^\/]+)\/memory\/([^\/]+)$/);
  if (amm) {
    const id = amm[1], mt = amm[2];
    const fn = mt === 'short' ? 'short-memory.md' : mt === 'long' ? 'long-memory.md' : null;
    if (!fn) return E(res, 'Invalid memory type');
    const mp = path.join(ROOT, 'agents', id, fn);
    if (m === 'GET') return J(res, { content: readText(mp) || '' });
    if (m === 'PUT') {
      const b = await parseBody(req);
      writeText(mp, typeof b === 'string' ? b : b.content || '');
      broadcast('agents');
      return J(res, { ok: true });
    }
  }

  const am = pn.match(/^\/api\/agents\/([^\/]+)$/);

  if (am && m === 'GET') {
    const d = readJSON(path.join(ROOT, 'agents', am[1], 'agent.json'));
    return d ? J(res, d) : E(res, 'Not found', 404);
  }

  // Reset agents (delete all sub-agents, keep orchestrator)
  if (pn === '/api/agents/reset' && m === 'POST') {
    const rp = path.join(ROOT, 'agents/_registry.json');
    const rg = readJSON(rp) || { agents: [] };
    var removed = 0;
    rg.agents.forEach(function(a) {
      if (a.isOrchestrator) return;
      var dir = path.join(ROOT, 'agents', a.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    });
    rg.agents = rg.agents.filter(function(a) { return a.isOrchestrator; });
    writeJSON(rp, rg);
    rebuildClaudeMd();
    broadcast('agents');
    return J(res, { ok: true, removed: removed });
  }

  if (pn === '/api/agents' && m === 'POST') {
    // Block sub-agent creation if system is not initialized
    const sysConf = readJSON(path.join(ROOT, 'config/system.json')) || {};
    if (!sysConf.initialized) {
      return E(res, 'System must be initialized before creating agents. Complete the setup wizard first.', 403);
    }
    const b = await parseBody(req);
    const id = b.id || genId();
    const dir = path.join(ROOT, 'agents', id);
    fs.mkdirSync(dir, { recursive: true });
    const a = {
      id: id, name: b.name || 'Unnamed', role: b.role || 'Agent',
      mission: b.mission || '', description: b.description || '',
      personality: b.personality || { traits: [], tone: '', style: '' },
      rules: b.rules || [], capabilities: b.capabilities || [],
      status: b.status || 'active', createdAt: new Date().toISOString()
    };
    writeJSON(path.join(dir, 'agent.json'), a);
    rebuildAgentMd(id, a);
    writeText(path.join(dir, 'short-memory.md'), '');
    writeText(path.join(dir, 'long-memory.md'), '');
    writeText(path.join(dir, 'rules.md'), (a.rules || []).map(function(r) { return '- ' + r; }).join('\n') + '\n');
    const rp = path.join(ROOT, 'agents/_registry.json');
    const rg = readJSON(rp) || { agents: [] };
    rg.agents.push({ id: id, name: a.name, role: a.role, status: a.status });
    writeJSON(rp, rg);
    rebuildClaudeMd();
    broadcast('agents');
    return J(res, a, 201);
  }

  if (am && m === 'PUT') {
    const id = am[1];
    const ap = path.join(ROOT, 'agents', id, 'agent.json');
    const ex = readJSON(ap);
    if (!ex) return E(res, 'Not found', 404);
    const b = await parseBody(req);
    const u = Object.assign({}, ex, b, { id: id });
    writeJSON(ap, u);
    rebuildAgentMd(id, u);
    if (b.rules) writeText(path.join(ROOT, 'agents', id, 'rules.md'), b.rules.map(function(r) { return '- ' + r; }).join('\n') + '\n');
    const rp = path.join(ROOT, 'agents/_registry.json');
    const rg = readJSON(rp) || { agents: [] };
    const i = rg.agents.findIndex(function(x) { return x.id === id; });
    if (i >= 0) rg.agents[i] = { id: id, name: u.name, role: u.role, status: u.status, isOrchestrator: u.isOrchestrator || false };
    writeJSON(rp, rg);
    rebuildClaudeMd();
    broadcast('agents');
    return J(res, u);
  }

  if (am && m === 'DELETE') {
    const id = am[1];
    var agentJson = readJSON(path.join(ROOT, 'agents', id, 'agent.json'));
    if (agentJson && agentJson.isOrchestrator) return E(res, 'Cannot delete the orchestrator agent', 403);

    const dir = path.join(ROOT, 'agents', id);
    if (!fs.existsSync(dir)) return E(res, 'Not found', 404);
    fs.rmSync(dir, { recursive: true, force: true });
    const rp = path.join(ROOT, 'agents/_registry.json');
    const rg = readJSON(rp) || { agents: [] };
    rg.agents = rg.agents.filter(function(x) { return x.id !== id; });
    writeJSON(rp, rg);
    rebuildClaudeMd();
    broadcast('agents');
    return J(res, { ok: true });
  }

  // TASKS
  if (pn === '/api/tasks' && m === 'GET')
    return J(res, readJSON(path.join(ROOT, 'data/tasks/_index.json')) || { tasks: [] });

  if (pn === '/api/tasks' && m === 'POST') {
    const b = await parseBody(req);
    const id = b.id || genId();
    const dir = path.join(ROOT, 'data/tasks', id);
    fs.mkdirSync(path.join(dir, 'v1'), { recursive: true });
    const t = {
      id: id, title: b.title || 'Untitled', description: b.description || '',
      assignedTo: b.assignedTo || null, status: b.status || 'draft',
      priority: b.priority || 'medium',
      channel: b.channel || '', version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    writeJSON(path.join(dir, 'task.json'), t);
    const ip = path.join(ROOT, 'data/tasks/_index.json');
    const ix = readJSON(ip) || { tasks: [] };
    ix.tasks.push({ id: id, title: t.title, status: t.status, assignedTo: t.assignedTo, priority: t.priority });
    writeJSON(ip, ix);
    broadcast('tasks');
    return J(res, t, 201);
  }

  const tm = pn.match(/^\/api\/tasks\/([^\/]+)$/);
  if (tm && m === 'GET') {
    const d = readJSON(path.join(ROOT, 'data/tasks', tm[1], 'task.json'));
    return d ? J(res, d) : E(res, 'Not found', 404);
  }
  if (tm && m === 'PUT') {
    const id = tm[1];
    const tp = path.join(ROOT, 'data/tasks', id, 'task.json');
    const ex = readJSON(tp);
    if (!ex) return E(res, 'Not found', 404);
    const b = await parseBody(req);
    const u = Object.assign({}, ex, b, { id: id, updatedAt: new Date().toISOString() });
    writeJSON(tp, u);
    const ip = path.join(ROOT, 'data/tasks/_index.json');
    const ix = readJSON(ip) || { tasks: [] };
    const i = ix.tasks.findIndex(function(x) { return x.id === id; });
    if (i >= 0) ix.tasks[i] = { id: id, title: u.title, status: u.status, assignedTo: u.assignedTo, priority: u.priority };
    writeJSON(ip, ix);
    broadcast('tasks');
    return J(res, u);
  }

  // RULES
  const rm = pn.match(/^\/api\/rules\/(team|security)$/);
  if (rm && m === 'GET')
    return J(res, { content: readText(path.join(ROOT, 'config/' + rm[1] + '-rules.md')) || '' });
  if (rm && m === 'PUT') {
    const b = await parseBody(req);
    writeText(path.join(ROOT, 'config/' + rm[1] + '-rules.md'), typeof b === 'string' ? b : b.content || '');
    rebuildClaudeMd();
    broadcast('rules');
    return J(res, { ok: true });
  }

  // TEMPLATES
  if (pn === '/api/templates' && m === 'GET') {
    const d = path.join(ROOT, 'config/agent-templates');
    try {
      const f = fs.readdirSync(d).filter(function(x) { return x.endsWith('.json'); });
      return J(res, f.map(function(x) { return readJSON(path.join(d, x)); }).filter(Boolean));
    } catch(e) { return J(res, []); }
  }

  // GENERIC FILE WRITE
  if (pn === '/api/write-file' && m === 'POST') {
    const b = await parseBody(req);
    if (!b.path || b.content === undefined) return E(res, 'path and content required');
    const r = writeSafePath(b.path);
    if (!r) return E(res, 'Forbidden path', 403);
    writeText(r, b.content);
    broadcast('all');
    return J(res, { ok: true });
  }

  // CLAUDE CLI STATUS
  if (pn === "/api/claude/status" && m === "GET") {
    return new Promise(function(resolve) {
      var result = { installed: false, version: null, authenticated: false, account: null };
      var proc1 = spawn("claude", ["--version"], { shell: true, timeout: 10000 });
      var out1 = "";
      proc1.stdout.on("data", function(ch) { out1 += ch; });
      proc1.stderr.on("data", function(ch) { out1 += ch; });
      proc1.on("close", function(code) {
        if (code === 0 && out1.trim()) { result.installed = true; result.version = out1.trim(); }
        J(res, result);
        resolve();
      });
      proc1.on("error", function() { J(res, result); resolve(); });
    });
  }

  // LEGACY FILE READ
  if (pn.startsWith('/api/file/')) {
    const fp = safePath(decodeURIComponent(pn.slice('/api/file/'.length)));
    if (!fp) { res.writeHead(403); return res.end('Forbidden'); }
    try { return J(res, { content: fs.readFileSync(fp, 'utf8') }); }
    catch(e) { res.writeHead(404); return res.end('Not found'); }
  }
  if (pn.startsWith('/api/ls/')) {
    const dp = safePath(decodeURIComponent(pn.slice('/api/ls/'.length)));
    if (!dp) { res.writeHead(403); return res.end('Forbidden'); }
    try {
      return J(res, fs.readdirSync(dp, { withFileTypes: true }).map(function(e) { return { name: e.name, isDir: e.isDirectory() }; }));
    } catch(e) { res.writeHead(404); return res.end('Not found'); }
  }

  // STATIC FILES
  let filePath = pn === '/' ? '/index.html' : pn;
  filePath = path.join(BASE, filePath);
  if (!filePath.startsWith(BASE)) { res.writeHead(403); return res.end('Forbidden'); }
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, function(e, data) {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    res.end(data);
  });
}

const server = http.createServer(function(req, res) {
  if (req.headers.upgrade) return; // Skip WebSocket upgrade requests
  const pn = new URL(req.url, "http://localhost").pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  handle(pn, req.method, req, res).catch(function(e) { console.error('Error:', e); E(res, 'Internal error', 500); });
});

// ── WebSocket Upgrade Handler ────────────────────────────
server.on('upgrade', function(req, socket, head) {
  if (req.url !== '/ws') { socket.destroy(); return; }

  var key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  var accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  wsClients.add(socket);

  var buf = Buffer.alloc(0);

  socket.on('data', function(data) {
    buf = Buffer.concat([buf, data]);

    while (buf.length > 0) {
      var frame = parseWsFrame(buf);
      if (!frame) break;
      buf = buf.slice(frame.totalLen);

      if (frame.opcode === 0x8) {
        var proc = activeProcesses.get(socket);
        if (proc) { try { proc.kill(); } catch(e) {} activeProcesses.delete(socket); }
        wsClients.delete(socket);
        try {
          var closeFrame = Buffer.alloc(2);
          closeFrame[0] = 0x88;
          closeFrame[1] = 0;
          socket.write(closeFrame);
        } catch(e) {}
        socket.destroy();
        return;
      }

      if (frame.opcode === 0x9) {
        var pong = Buffer.alloc(2);
        pong[0] = 0x8a; pong[1] = 0;
        try { socket.write(pong); } catch(e) {}
        continue;
      }

      if (frame.opcode === 0x1) {
        try {
          var msg = JSON.parse(frame.payload.toString('utf8'));
          if (msg.type === 'chat' && msg.content) {
            spawnClaude(msg.content, socket);
          } else if (msg.type === 'stop') {
            var proc = activeProcesses.get(socket);
            if (proc) { try { proc.kill(); } catch(e) {} activeProcesses.delete(socket); }
          }
        } catch(e) {
          wsSend(socket, { type: 'claude-error', error: 'Invalid message format' });
        }
      }
    }
  });

  socket.on('close', function() {
    wsClients.delete(socket);
    var proc = activeProcesses.get(socket);
    if (proc) { try { proc.kill(); } catch(e) {} activeProcesses.delete(socket); }
  });

  socket.on('error', function() {
    wsClients.delete(socket);
    var proc = activeProcesses.get(socket);
    if (proc) { try { proc.kill(); } catch(e) {} activeProcesses.delete(socket); }
  });
});

// ── Startup ──────────────────────────────────────────────
ensureOrchestrator();

(async function() {
  var envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
  var configPort = getConfiguredPort();
  var requestedPort = envPort || configPort || 3777;

  // If the requested port is busy, find the next free one
  if (await isPortFree(requestedPort)) {
    PORT = requestedPort;
  } else {
    PORT = await findFreePort(requestedPort + 1);
    console.log('  Port ' + requestedPort + ' is busy, using ' + PORT + ' instead.');
  }

  // Save the port so this instance reuses it on restart
  if (!envPort) savePort(PORT);

  server.listen(PORT, function() { console.log('\n  Agent Team Portal running at http://localhost:' + PORT + '\n'); });
})();
