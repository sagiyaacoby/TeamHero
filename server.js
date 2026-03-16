const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');

// Check if a command-line tool is available on the system
function commandExists(cmd) {
  try {
    execSync(process.platform === 'win32' ? 'where ' + cmd : 'which ' + cmd,
      { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch(e) {
    return false;
  }
}

// Known package managers for installing system dependencies
function getInstallCommand(dep) {
  var p = process.platform;
  if (p === 'win32') {
    if (commandExists('winget')) return { cmd: 'winget', args: ['install', '--id', dep.winget || dep, '-e', '--accept-source-agreements', '--accept-package-agreements'] };
    if (commandExists('choco')) return { cmd: 'choco', args: ['install', dep.choco || dep, '-y'] };
    return null;
  }
  if (p === 'darwin') {
    if (commandExists('brew')) return { cmd: 'brew', args: ['install', dep.brew || dep] };
    return null;
  }
  // Linux
  if (commandExists('apt-get')) return { cmd: 'sudo', args: ['apt-get', 'install', '-y', dep.apt || dep] };
  if (commandExists('yum')) return { cmd: 'sudo', args: ['yum', 'install', '-y', dep.yum || dep] };
  if (commandExists('pacman')) return { cmd: 'sudo', args: ['pacman', '-S', '--noconfirm', dep.pacman || dep] };
  return null;
}

// Map of system dep names to package manager identifiers
var SYSTEM_DEP_MAP = {
  'ffmpeg': { winget: 'Gyan.FFmpeg', choco: 'ffmpeg', brew: 'ffmpeg', apt: 'ffmpeg', yum: 'ffmpeg', pacman: 'ffmpeg' },
  'python': { winget: 'Python.Python.3.12', choco: 'python3', brew: 'python3', apt: 'python3', yum: 'python3', pacman: 'python' },
  'git': { winget: 'Git.Git', choco: 'git', brew: 'git', apt: 'git', yum: 'git', pacman: 'git' }
};

// Attempt to install a system dependency, returns { success, output }
function installSystemDep(depName) {
  var depInfo = SYSTEM_DEP_MAP[depName] || depName;
  var installCmd = getInstallCommand(depInfo);
  if (!installCmd) {
    return { success: false, output: 'No package manager found to install "' + depName + '". Please install it manually.' };
  }
  try {
    var output = execSync(installCmd.cmd + ' ' + installCmd.args.join(' '),
      { timeout: 300000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    // Verify it's now available
    if (commandExists(depName)) {
      return { success: true, output: 'Installed ' + depName + ' successfully.' };
    }
    return { success: false, output: 'Install command ran but "' + depName + '" still not found in PATH. Output: ' + output };
  } catch(e) {
    return { success: false, output: 'Failed to install "' + depName + '": ' + (e.stderr || e.message) };
  }
}

var pty;
try { pty = require('node-pty'); }
catch(e) { try { pty = require('node-pty-prebuilt-multiarch'); } catch(e2) { pty = null; } }

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
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.txt': 'text/plain', '.csv': 'text/csv',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
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

// ── Encrypted Secrets Manager ────────────────────────────
var secretsCache = null;   // decrypted { name: value } map, null when locked
var masterKeyCache = null; // derived key buffer
var secretsSalt = null;    // salt used for PBKDF2

function getSecretsFilePath() { return path.join(ROOT, 'config/secrets.enc'); }

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

function encryptSecrets(secretsObj, derivedKey, salt) {
  var plaintext = Buffer.from(JSON.stringify(secretsObj), 'utf8');
  var iv = crypto.randomBytes(12);
  var cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  var encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  var authTag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

function decryptSecrets(fileBuffer, password) {
  var salt = fileBuffer.slice(0, 32);
  var iv = fileBuffer.slice(32, 44);
  var authTag = fileBuffer.slice(44, 60);
  var ciphertext = fileBuffer.slice(60);
  var key = deriveKey(password, salt);
  var decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  var decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return { secrets: JSON.parse(decrypted.toString('utf8')), key: key, salt: salt };
}

function saveSecretsFile() {
  if (!secretsCache || !masterKeyCache || !secretsSalt) return;
  var data = encryptSecrets(secretsCache, masterKeyCache, secretsSalt);
  fs.mkdirSync(path.dirname(getSecretsFilePath()), { recursive: true });
  fs.writeFileSync(getSecretsFilePath(), data);
}

function scrubSecrets(text) {
  if (!secretsCache) return text;
  var result = text;
  var keys = Object.keys(secretsCache);
  for (var i = 0; i < keys.length; i++) {
    var val = secretsCache[keys[i]];
    if (val && val.length >= 4) {
      var escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
  }
  return result;
}

function maskValue(val) {
  if (!val) return '****';
  if (val.length <= 4) return '****';
  return '****' + val.slice(-4);
}

function getSecretNames() {
  if (secretsCache) return Object.keys(secretsCache);
  return [];
}

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
  if (!rg.agents || !Array.isArray(rg.agents)) rg = { agents: [] };
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
    'Use Claude Code\'s **Agent tool** to delegate work to subagents. Never do agent work yourself.\n\n' +
    'When the owner asks you to perform work that matches a specific agent\'s role:\n' +
    '1. Launch a subagent via the **Agent tool** with a prompt that includes:\n' +
    '   - The agent identity: "You are {name}, read your definition at `agents/{id}/agent.md`"\n' +
    '   - Memory files to read: `agents/{id}/short-memory.md` and `agents/{id}/long-memory.md`\n' +
    '   - The task to execute and its ID\n' +
    '   - The API base URL: `http://localhost:' + port + '`\n' +
    '   - Instructions to: adopt the agent persona, execute the work, update task status via API, update agent memory when done\n' +
    '2. For independent tasks, launch **multiple Agent tool calls in one message** for parallel execution\n' +
    '3. Use `run_in_background: true` for tasks that don\'t need immediate results\n' +
    '4. Each subagent has full tool access (Read, Edit, Write, Bash, Grep, Glob)\n\n' +
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
    '- **Create task:** `POST /api/tasks` with `{"title","description","assignedTo","status":"draft","priority":"medium","type":"general"}`\n' +
    '  - Supported types: `general`, `research`, `development`, `content`, `review`, `operations`\n' +
    '- **Update task:** `PUT /api/tasks/{id}` with JSON body (partial update, e.g. `{"status":"done"}`)\n' +
    '- **Log progress:** `POST /api/tasks/{id}/progress` with `{"message":"...","agentId":"..."}`\n' +
    '- **Get progress:** `GET /api/tasks/{id}/progress`\n' +
    '- **Promote to knowledge:** `POST /api/tasks/{id}/promote` — copies deliverable to Knowledge Base\n\n' +
    '### Knowledge Base\n' +
    '- **List documents:** `GET /api/knowledge`\n' +
    '- **Create document:** `POST /api/knowledge` with `{"title","content","category","tags":[],"summary","sourceTaskId","authorAgentId"}`\n' +
    '  - Categories: `research`, `analysis`, `reference`, `guide`\n' +
    '- **Get metadata:** `GET /api/knowledge/{id}`\n' +
    '- **Get content:** `GET /api/knowledge/{id}/content`\n' +
    '- **Update:** `PUT /api/knowledge/{id}` with JSON body (partial update)\n' +
    '- **Delete:** `DELETE /api/knowledge/{id}`\n\n' +
    '### Other\n' +
    '- **Update profile:** `PUT /api/profile` with owner JSON\n' +
    '- **Update rules:** `PUT /api/rules/team` or `/security` with `{"content":"..."}`\n' +
    '- **Rebuild CLAUDE.md:** `POST /api/rebuild-context`\n' +
    '- **Write file:** `POST /api/write-file` with `{"path":"...","content":"..."}`\n' +
    '- **Temp status:** `GET /api/temp/status` \u2014 returns `{ fileCount, totalSizeMB }`\n' +
    '- **Clean temp:** `POST /api/temp/cleanup` \u2014 deletes all contents of `temp/`\n\n' +
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
    '## Safety Boundaries\n\n' +
    'CRITICAL: These rules are enforced at all times regardless of permission mode.\n\n' +
    '- **Project folder only:** ALL file operations (read, write, delete) must stay within `' + ROOT.replace(/\\/g, '/') + '/`. Never access files outside this directory.\n' +
    '- **Never modify platform files:** Do not edit `server.js`, `portal/`, `launch.bat`, `launch.sh`, or `package.json`. These are managed by the upgrade system.\n' +
    '- **Never expose secrets:** Environment variables containing API keys or tokens must never be echoed, logged, written to files, or included in any output. Use them only as pass-through in commands.\n' +
    '- **No destructive system commands:** Do not run commands that affect the OS, other processes, or network infrastructure (e.g. `rm -rf /`, `shutdown`, `format`, `kill`, `netsh`).\n' +
    '- **No external communications without approval:** Do not send emails, post to APIs, push to git, or make any external network calls unless the owner explicitly requests it.\n\n' +
    '## Round Table Protocol\n\n' +
    'A "round table" is a structured review session. When asked to run one:\n' +
    '1. Scan all tasks in `data/tasks/` \u2014 review each task\'s status\n' +
    '2. For each agent, summarize what they\'ve accomplished and what\'s pending\n' +
    '3. Present items needing approval to the owner\n' +
    '4. Review knowledge base \u2014 list recent additions, flag stale docs (>30 days since update)\n' +
    '5. Create a round table summary in `data/round-tables/` with timestamp filename\n' +
    '6. Update each agent\'s short-memory with round table outcomes\n' +
    '7. Clear completed items from short-memory\n\n' +
    '## Task Lifecycle\n\n' +
    'Tasks flow through: `draft` \u2192 `in_progress` \u2192 `pending_approval` \u2192 `approved` / `revision_needed` / `hold` \u2192 `done`\n\n' +
    'When a task is approved, the orchestrator MUST ensure the assigned agent begins executing it. Follow up by setting the task to `in_progress` and confirming the agent is working on it.\n\n' +
    'Task files: `data/tasks/{task-id}/task.json` with version folders `v1/`, `v2/`, etc.\n\n' +
    '## File Structure Reference\n\n' +
    '- `config/system.json` \u2014 System configuration\n' +
    '- `config/team-rules.md` \u2014 Team operational rules\n' +
    '- `config/security-rules.md` \u2014 Security guidelines\n' +
    '- `profile/owner.json` / `owner.md` \u2014 Owner profile\n' +
    '- `agents/_registry.json` \u2014 Agent registry\n' +
    '- `agents/{id}/` \u2014 Individual agent folders\n' +
    '- `data/tasks/` \u2014 All tasks\n' +
    '- `data/knowledge/` \u2014 Knowledge base documents\n' +
    '- `data/round-tables/` \u2014 Round table summaries\n' +
    '- `data/media/` \u2014 Shared media library\n' +
    '- `temp/` \u2014 Temporary workspace for agent artifacts (auto-cleaned)\n\n' +
    '## Temp Workspace\n\n' +
    'The `temp/` folder is a shared scratch space for agent work products (screenshots, downloads, generated files, Playwright artifacts).\n\n' +
    '**Rules:**\n' +
    '- Save all temporary/intermediate files to `temp/` \u2014 never to the project root\n' +
    '- Playwright artifacts go to `temp/playwright/`\n' +
    '- Organize by purpose: `temp/screenshots/`, `temp/downloads/`, etc.\n' +
    '- Files in `temp/` are disposable \u2014 they may be cleaned at any time\n' +
    '- Never store deliverables in `temp/` \u2014 use `data/tasks/{id}/v{n}/` instead\n\n' +
    '## Available Secrets\n\n' +
    'These environment variables are injected into your session when secrets are unlocked:\n\n' +
    (function() {
      var names = getSecretNames();
      if (names.length === 0) return '_No secrets configured. Add them via dashboard Settings > Secrets & API Keys._\n';
      return names.map(function(n) { return '- `$' + n + '`'; }).join('\n') + '\n\n' +
        'Use these as environment variables in commands (e.g. `$OPENAI_API_KEY`). Never echo or output their values.\n';
    })();

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

// ── Upgrade / Update Mechanism (GitHub Releases) ─────────
var GITHUB_REPO = 'sagiyaacoby/TeamHero';
var PLATFORM_FILES = ['server.js', 'portal/', 'launch.sh', 'launch.bat', 'config/agent-templates/', '.gitignore', 'package.json', 'package-lock.json'];

function httpsGet(url) {
  var https = require('https');
  return new Promise(function(resolve, reject) {
    var opts = { headers: { 'User-Agent': 'TeamHero-Updater', 'Accept': 'application/vnd.github.v3+json' } };
    var parsed = new URL(url);
    opts.hostname = parsed.hostname;
    opts.path = parsed.pathname + parsed.search;
    https.get(opts, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      var data = [];
      res.on('data', function(ch) { data.push(ch); });
      res.on('end', function() {
        var buf = Buffer.concat(data);
        resolve({ statusCode: res.statusCode, body: buf });
      });
    }).on('error', reject);
  });
}

function compareVersions(a, b) {
  // Returns >0 if b is newer than a
  var pa = (a || '0.0.0').split('.').map(Number);
  var pb = (b || '0.0.0').split('.').map(Number);
  for (var i = 0; i < 3; i++) {
    if ((pb[i] || 0) > (pa[i] || 0)) return 1;
    if ((pb[i] || 0) < (pa[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdates() {
  var localPkg = readJSON(path.join(ROOT, 'package.json'));
  var localVersion = localPkg ? localPkg.version : '1.0.0';

  try {
    var res = await httpsGet('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest');
    if (res.statusCode === 404) {
      return { updateAvailable: false, currentVersion: localVersion, latestVersion: localVersion, error: 'No releases published yet.' };
    }
    if (res.statusCode !== 200) {
      return { updateAvailable: false, currentVersion: localVersion, error: 'GitHub API error: HTTP ' + res.statusCode };
    }
    var release = JSON.parse(res.body.toString());
    var latestVersion = (release.tag_name || '').replace(/^v/, '');
    var updateAvailable = compareVersions(localVersion, latestVersion) > 0;
    var releaseNotes = release.body || '';
    // Truncate long notes
    if (releaseNotes.length > 1000) releaseNotes = releaseNotes.slice(0, 1000) + '...';

    return {
      updateAvailable: updateAvailable,
      currentVersion: localVersion,
      latestVersion: latestVersion,
      releaseNotes: releaseNotes,
      releaseName: release.name || release.tag_name || '',
      releaseUrl: release.html_url || '',
      tarballUrl: release.tarball_url || '',
      publishedAt: release.published_at || '',
      repoUrl: 'https://github.com/' + GITHUB_REPO,
    };
  } catch(e) {
    return { updateAvailable: false, currentVersion: localVersion, error: 'Failed to check for updates: ' + e.message };
  }
}

async function performUpgrade() {
  var check = await checkForUpdates();
  if (!check.updateAvailable) return { success: false, message: 'Already up to date.' };
  if (!check.tarballUrl) return { success: false, message: 'No download URL available.' };

  try {
    // Download the release tarball
    var tarRes = await httpsGet(check.tarballUrl);
    if (tarRes.statusCode !== 200) return { success: false, message: 'Download failed: HTTP ' + tarRes.statusCode };

    var zlib = require('zlib');
    var tarData = zlib.gunzipSync(tarRes.body);

    // Parse tar and extract platform files
    var extracted = 0;
    var offset = 0;
    var stripPrefix = ''; // GitHub tarballs have a top-level dir like "user-repo-hash/"

    while (offset < tarData.length) {
      // Tar header is 512 bytes
      var header = tarData.slice(offset, offset + 512);
      if (header.length < 512 || header[0] === 0) break;

      var fileName = header.slice(0, 100).toString('utf8').replace(/\0/g, '');
      // Handle long names via prefix field (bytes 345-500)
      var prefix = header.slice(345, 500).toString('utf8').replace(/\0/g, '');
      if (prefix) fileName = prefix + '/' + fileName;

      var sizeOctal = header.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
      var fileSize = parseInt(sizeOctal, 8) || 0;
      var typeFlag = header[156];

      offset += 512; // past header

      // Detect strip prefix from first entry
      if (!stripPrefix && fileName.indexOf('/') > 0) {
        stripPrefix = fileName.slice(0, fileName.indexOf('/') + 1);
      }

      // Strip the top-level directory
      var relPath = fileName;
      if (stripPrefix && relPath.startsWith(stripPrefix)) {
        relPath = relPath.slice(stripPrefix.length);
      }

      if (relPath && fileSize > 0 && typeFlag === 48) { // typeFlag 48 = '0' = regular file
        // Check if this is a platform file we should update
        var isPlatform = PLATFORM_FILES.some(function(pf) {
          if (pf.endsWith('/')) return relPath.startsWith(pf);
          return relPath === pf;
        });

        if (isPlatform) {
          var fileData = tarData.slice(offset, offset + fileSize);
          var destPath = path.join(ROOT, relPath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, fileData);
          extracted++;
        }
      }

      // Advance past file data (padded to 512-byte boundary)
      offset += Math.ceil(fileSize / 512) * 512;
    }

    return {
      success: true,
      message: 'Updated to v' + check.latestVersion + '. ' + extracted + ' files updated. Restart the server to apply.',
      extractedFiles: extracted,
      restartRequired: true,
    };
  } catch(e) {
    return { success: false, message: 'Upgrade failed: ' + e.message };
  }
}

// ── PTY Terminal Session Manager ─────────────────────────
var termSessions = new Map();
var MAX_BUFFER = 50 * 1024; // 50KB rolling buffer for reconnect replay

function createTermSession(sessionId, socket) {
  if (!pty) {
    wsSend(socket, { type: 'terminal-error', error: 'Terminal not available. Run `npm install` in the project directory.' });
    return null;
  }

  var isWindows = process.platform === 'win32';
  var shell = isWindows ? 'cmd.exe' : 'bash';
  var sys = readJSON(path.join(ROOT, 'config/system.json')) || {};
  var permMode = sys.claudePermissionMode || 'autonomous';
  var claudeCmd = permMode === 'supervised' ? 'claude' : 'claude --dangerously-skip-permissions';
  var shellArgs = isWindows ? ['/c', claudeCmd] : ['-c', claudeCmd];

  var envVars = Object.assign({}, process.env, {
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
  });
  // Inject decrypted secrets as environment variables
  if (secretsCache) {
    var skeys = Object.keys(secretsCache);
    for (var si = 0; si < skeys.length; si++) { envVars[skeys[si]] = secretsCache[skeys[si]]; }
  }

  var term = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: ROOT,
    env: envVars,
  });

  var session = {
    pty: term,
    outputBuffer: '',
    socket: socket,
    timeout: null,
  };

  term.onData(function(data) {
    // Append to rolling buffer
    session.outputBuffer += data;
    if (session.outputBuffer.length > MAX_BUFFER) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER);
    }
    // Send to connected client (scrub secrets from output)
    if (session.socket) {
      wsSend(session.socket, { type: 'terminal-output', data: scrubSecrets(data) });
    }
  });

  term.onExit(function(ev) {
    if (session.socket) {
      wsSend(session.socket, { type: 'terminal-exit', code: ev.exitCode });
    }
    termSessions.delete(sessionId);
    // Claude may have modified files via API — broadcast refresh
    broadcast('all');
  });

  termSessions.set(sessionId, session);
  return session;
}

function detachTermSession(sessionId) {
  var session = termSessions.get(sessionId);
  if (!session) return;
  session.socket = null;
  // Start 5-min timeout to kill orphaned PTY
  session.timeout = setTimeout(function() {
    var s = termSessions.get(sessionId);
    if (s && !s.socket) {
      try { s.pty.kill(); } catch(e) {}
      termSessions.delete(sessionId);
    }
  }, 5 * 60 * 1000);
}

function reattachTermSession(sessionId, socket) {
  var session = termSessions.get(sessionId);
  if (!session) return null;
  // Clear orphan timeout
  if (session.timeout) { clearTimeout(session.timeout); session.timeout = null; }
  session.socket = socket;
  // Replay buffer (scrub secrets)
  if (session.outputBuffer) {
    wsSend(socket, { type: 'terminal-output', data: scrubSecrets(session.outputBuffer) });
  }
  return session;
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
    const now = new Date().toISOString();
    const t = {
      id: id, title: b.title || 'Untitled', description: b.description || '',
      assignedTo: b.assignedTo || null, status: b.status || 'draft',
      priority: b.priority || 'medium',
      type: b.type || 'general',
      channel: b.channel || '', version: 1,
      tags: Array.isArray(b.tags) ? b.tags : [],
      brief: b.brief || '',
      progressLog: [],
      createdAt: now, updatedAt: now
    };
    writeJSON(path.join(dir, 'task.json'), t);
    // Write initial v1/version.json
    writeJSON(path.join(dir, 'v1/version.json'), {
      number: 1, content: b.content || '', status: 'submitted',
      decision: null, comments: '', submittedAt: now, decidedAt: null,
      deliverable: b.deliverable || '', result: b.result || ''
    });
    const ip = path.join(ROOT, 'data/tasks/_index.json');
    const ix = readJSON(ip) || { tasks: [] };
    ix.tasks.push({ id: id, title: t.title, status: t.status, assignedTo: t.assignedTo, priority: t.priority, type: t.type });
    writeJSON(ip, ix);
    broadcast('tasks');
    return J(res, t, 201);
  }

  // TASK PROGRESS LOG
  const tpm = pn.match(/^\/api\/tasks\/([^\/]+)\/progress$/);
  if (tpm && m === 'POST') {
    const taskId = tpm[1];
    const tp = path.join(ROOT, 'data/tasks', taskId, 'task.json');
    const ex = readJSON(tp);
    if (!ex) return E(res, 'Not found', 404);
    const b = await parseBody(req);
    if (!b.message) return E(res, 'message required');
    var entry = { message: b.message, agentId: b.agentId || null, timestamp: new Date().toISOString() };
    if (!ex.progressLog) ex.progressLog = [];
    ex.progressLog.push(entry);
    ex.updatedAt = new Date().toISOString();
    writeJSON(tp, ex);
    broadcast('tasks');
    return J(res, entry, 201);
  }
  if (tpm && m === 'GET') {
    const taskId = tpm[1];
    const tp = path.join(ROOT, 'data/tasks', taskId, 'task.json');
    const ex = readJSON(tp);
    if (!ex) return E(res, 'Not found', 404);
    return J(res, ex.progressLog || []);
  }

  // TASK PROMOTE TO KNOWLEDGE
  const tprom = pn.match(/^\/api\/tasks\/([^\/]+)\/promote$/);
  if (tprom && m === 'POST') {
    const taskId = tprom[1];
    const tp = path.join(ROOT, 'data/tasks', taskId, 'task.json');
    const task = readJSON(tp);
    if (!task) return E(res, 'Not found', 404);
    if (task.knowledgeDocId) return E(res, 'Already promoted', 400);

    // Find latest version with content
    var taskDir = path.join(ROOT, 'data/tasks', taskId);
    var latestV = task.version || 1;
    try {
      var entries = fs.readdirSync(taskDir);
      entries.forEach(function(e) {
        if (/^v\d+$/.test(e)) {
          var n = parseInt(e.slice(1));
          if (n > latestV) latestV = n;
        }
      });
    } catch(e) {}
    var vData = readJSON(path.join(taskDir, 'v' + latestV, 'version.json')) || {};
    var content = vData.content || vData.deliverable || task.description || '';

    var docId = genId();
    var now = new Date().toISOString();
    var doc = {
      id: docId, title: task.title, content: content,
      category: task.type === 'research' ? 'research' : 'reference',
      tags: task.tags || [], summary: task.description || '',
      sourceTaskId: taskId, authorAgentId: task.assignedTo || null,
      createdAt: now, updatedAt: now
    };
    var kDir = path.join(ROOT, 'data/knowledge');
    fs.mkdirSync(kDir, { recursive: true });
    writeText(path.join(kDir, docId + '.md'), content);
    var kip = path.join(kDir, '_index.json');
    var kix = readJSON(kip) || { documents: [] };
    var meta = Object.assign({}, doc);
    delete meta.content;
    kix.documents.push(meta);
    writeJSON(kip, kix);

    task.knowledgeDocId = docId;
    task.updatedAt = now;
    writeJSON(tp, task);
    broadcast('tasks');
    broadcast('knowledge');
    return J(res, doc, 201);
  }

  // TASK VERSIONS
  const tvm = pn.match(/^\/api\/tasks\/([^\/]+)\/versions$/);
  if (tvm && m === 'GET') {
    const taskDir = path.join(ROOT, 'data/tasks', tvm[1]);
    if (!fs.existsSync(taskDir)) return E(res, 'Not found', 404);
    var versions = [];
    try {
      var entries = fs.readdirSync(taskDir);
      entries.forEach(function(e) {
        if (/^v\d+$/.test(e)) {
          var vp = path.join(taskDir, e, 'version.json');
          var vd = readJSON(vp);
          if (!vd) vd = { number: parseInt(e.slice(1)), content: '', status: 'empty', decision: null, comments: '', submittedAt: null, decidedAt: null };
          // Attach list of extra files in version folder
          try {
            var vFiles = fs.readdirSync(path.join(taskDir, e));
            vd.files = vFiles.filter(function(f) { return f !== 'version.json'; });
          } catch(fe) { vd.files = []; }
          versions.push(vd);
        }
      });
    } catch(e) {}
    versions.sort(function(a, b) { return a.number - b.number; });
    return J(res, versions);
  }

  // SERVE VERSION FILE CONTENT
  const tvf = pn.match(/^\/api\/tasks\/([^\/]+)\/versions\/(\d+)\/files\/(.+)$/);
  if (tvf && m === 'GET') {
    var filePath = path.join(ROOT, 'data/tasks', tvf[1], 'v' + tvf[2], decodeURIComponent(tvf[3]));
    // Prevent directory traversal
    if (!filePath.startsWith(path.join(ROOT, 'data/tasks', tvf[1]))) return E(res, 'Forbidden', 403);
    if (!fs.existsSync(filePath)) return E(res, 'Not found', 404);
    var content = fs.readFileSync(filePath, 'utf8');
    return J(res, { filename: tvf[3], content: content });
  }

  const tvmn = pn.match(/^\/api\/tasks\/([^\/]+)\/versions\/(\d+)$/);
  if (tvmn && m === 'PUT') {
    const taskId = tvmn[1];
    const vnum = parseInt(tvmn[2]);
    const vDir = path.join(ROOT, 'data/tasks', taskId, 'v' + vnum);
    if (!fs.existsSync(vDir)) fs.mkdirSync(vDir, { recursive: true });
    const vp = path.join(vDir, 'version.json');
    const existing = readJSON(vp) || { number: vnum, content: '', status: 'submitted', decision: null, comments: '', submittedAt: null, decidedAt: null };
    const b = await parseBody(req);
    var updated = Object.assign({}, existing, b, { number: vnum });
    if (b.content !== undefined && !existing.submittedAt) updated.submittedAt = new Date().toISOString();
    writeJSON(vp, updated);
    broadcast('tasks');
    return J(res, updated);
  }

  const tm = pn.match(/^\/api\/tasks\/([^\/]+)$/);
  if (tm && m === 'GET') {
    const d = readJSON(path.join(ROOT, 'data/tasks', tm[1], 'task.json'));
    if (!d) return E(res, 'Not found', 404);
    // Check if task has deliverable output (files in latest version dir, or version with deliverable/result)
    var taskDir = path.join(ROOT, 'data/tasks', tm[1]);
    var hasDeliverable = false;
    try {
      var latestV = d.version || 1;
      var entries = fs.readdirSync(taskDir);
      entries.forEach(function(e) { if (/^v\d+$/.test(e)) { var n = parseInt(e.slice(1)); if (n > latestV) latestV = n; } });
      var vDir = path.join(taskDir, 'v' + latestV);
      var vData = readJSON(path.join(vDir, 'version.json'));
      if (vData && (vData.deliverable || vData.result)) hasDeliverable = true;
      // Also check for any non-json files in version dir (media, docs)
      if (!hasDeliverable) {
        var vFiles = fs.readdirSync(vDir);
        hasDeliverable = vFiles.some(function(f) { return f !== 'version.json'; });
      }
    } catch(e) {}
    d.hasDeliverable = hasDeliverable;
    return J(res, d);
  }
  if (tm && m === 'PUT') {
    const id = tm[1];
    const tp = path.join(ROOT, 'data/tasks', id, 'task.json');
    const ex = readJSON(tp);
    if (!ex) return E(res, 'Not found', 404);
    const b = await parseBody(req);
    const now = new Date().toISOString();

    // Handle review actions: done, approve, improve, cancel, hold
    if (b.action === 'done' || b.action === 'approve' || b.action === 'improve' || b.action === 'cancel' || b.action === 'hold') {
      // Find the latest version
      var taskDir = path.join(ROOT, 'data/tasks', id);
      var latestV = ex.version || 1;
      try {
        var entries = fs.readdirSync(taskDir);
        entries.forEach(function(e) {
          if (/^v\d+$/.test(e)) {
            var n = parseInt(e.slice(1));
            if (n > latestV) latestV = n;
          }
        });
      } catch(e) {}

      var vPath = path.join(taskDir, 'v' + latestV, 'version.json');
      var vData = readJSON(vPath) || { number: latestV, content: '', status: 'submitted', decision: null, comments: '', submittedAt: null, decidedAt: null };

      var actionResult;
      vData.comments = b.comments || '';
      vData.decidedAt = now;

      if (b.action === 'done') {
        vData.decision = 'done';
        writeJSON(vPath, vData);
        actionResult = Object.assign({}, ex, { status: 'done', updatedAt: now });
      } else if (b.action === 'approve') {
        vData.decision = 'approved';
        writeJSON(vPath, vData);
        actionResult = Object.assign({}, ex, { status: 'approved', updatedAt: now });
      } else if (b.action === 'improve') {
        vData.decision = 'improve';
        writeJSON(vPath, vData);
        var nextV = latestV + 1;
        var nextDir = path.join(taskDir, 'v' + nextV);
        fs.mkdirSync(nextDir, { recursive: true });
        writeJSON(path.join(nextDir, 'version.json'), {
          number: nextV, content: '', status: 'draft',
          decision: null, comments: '', submittedAt: null, decidedAt: null
        });
        actionResult = Object.assign({}, ex, { status: 'revision_needed', version: nextV, updatedAt: now });
      } else if (b.action === 'hold') {
        vData.decision = 'hold';
        writeJSON(vPath, vData);
        actionResult = Object.assign({}, ex, { status: 'hold', updatedAt: now });
      } else {
        vData.decision = 'cancelled';
        writeJSON(vPath, vData);
        actionResult = Object.assign({}, ex, { status: 'cancelled', updatedAt: now });
      }

      writeJSON(tp, actionResult);
      var aip = path.join(ROOT, 'data/tasks/_index.json');
      var aix = readJSON(aip) || { tasks: [] };
      var ai = aix.tasks.findIndex(function(x) { return x.id === id; });
      if (ai >= 0) aix.tasks[ai] = { id: id, title: actionResult.title, status: actionResult.status, assignedTo: actionResult.assignedTo, priority: actionResult.priority, type: actionResult.type || 'general' };
      writeJSON(aip, aix);
      broadcast('tasks');
      return J(res, actionResult);
    }

    // Default: merge update
    var merged = Object.assign({}, ex, b, { id: id, updatedAt: now });
    writeJSON(tp, merged);
    var mip = path.join(ROOT, 'data/tasks/_index.json');
    var mix = readJSON(mip) || { tasks: [] };
    var mi = mix.tasks.findIndex(function(x) { return x.id === id; });
    if (mi >= 0) mix.tasks[mi] = { id: id, title: merged.title, status: merged.status, assignedTo: merged.assignedTo, priority: merged.priority, type: merged.type || 'general' };
    writeJSON(mip, mix);
    broadcast('tasks');
    return J(res, merged);
  }

  // KNOWLEDGE BASE
  if (pn === '/api/knowledge' && m === 'GET') {
    var kip = path.join(ROOT, 'data/knowledge/_index.json');
    return J(res, readJSON(kip) || { documents: [] });
  }
  if (pn === '/api/knowledge' && m === 'POST') {
    const b = await parseBody(req);
    var docId = genId();
    var now = new Date().toISOString();
    var doc = {
      id: docId, title: b.title || 'Untitled',
      category: b.category || 'reference',
      tags: Array.isArray(b.tags) ? b.tags : [],
      summary: b.summary || '',
      sourceTaskId: b.sourceTaskId || null,
      authorAgentId: b.authorAgentId || null,
      createdAt: now, updatedAt: now
    };
    var kDir = path.join(ROOT, 'data/knowledge');
    fs.mkdirSync(kDir, { recursive: true });
    writeText(path.join(kDir, docId + '.md'), b.content || '');
    var kip = path.join(kDir, '_index.json');
    var kix = readJSON(kip) || { documents: [] };
    kix.documents.push(doc);
    writeJSON(kip, kix);
    broadcast('knowledge');
    return J(res, doc, 201);
  }

  var km = pn.match(/^\/api\/knowledge\/([^\/]+)$/);
  var kmc = pn.match(/^\/api\/knowledge\/([^\/]+)\/content$/);

  if (kmc && m === 'GET') {
    var docId = kmc[1];
    var fp = path.join(ROOT, 'data/knowledge', docId + '.md');
    var content = readText(fp);
    if (content === null) return E(res, 'Not found', 404);
    return J(res, { id: docId, content: content });
  }

  if (km && m === 'GET') {
    var docId = km[1];
    var kip = path.join(ROOT, 'data/knowledge/_index.json');
    var kix = readJSON(kip) || { documents: [] };
    var doc = kix.documents.find(function(d) { return d.id === docId; });
    if (!doc) return E(res, 'Not found', 404);
    return J(res, doc);
  }
  if (km && m === 'PUT') {
    var docId = km[1];
    var kip = path.join(ROOT, 'data/knowledge/_index.json');
    var kix = readJSON(kip) || { documents: [] };
    var idx = kix.documents.findIndex(function(d) { return d.id === docId; });
    if (idx < 0) return E(res, 'Not found', 404);
    const b = await parseBody(req);
    var now = new Date().toISOString();
    if (b.content !== undefined) {
      writeText(path.join(ROOT, 'data/knowledge', docId + '.md'), b.content);
      delete b.content;
    }
    kix.documents[idx] = Object.assign({}, kix.documents[idx], b, { id: docId, updatedAt: now });
    writeJSON(kip, kix);
    broadcast('knowledge');
    return J(res, kix.documents[idx]);
  }
  if (km && m === 'DELETE') {
    var docId = km[1];
    var kip = path.join(ROOT, 'data/knowledge/_index.json');
    var kix = readJSON(kip) || { documents: [] };
    kix.documents = kix.documents.filter(function(d) { return d.id !== docId; });
    writeJSON(kip, kix);
    try { fs.unlinkSync(path.join(ROOT, 'data/knowledge', docId + '.md')); } catch(e) {}
    broadcast('knowledge');
    return J(res, { ok: true });
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

  // TEMP WORKSPACE
  if (pn === '/api/temp/status' && m === 'GET') {
    var tempDir = path.join(ROOT, 'temp');
    var fileCount = 0, totalSize = 0;
    function countDir(dir) {
      try {
        var entries = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          var fp = path.join(dir, entries[i].name);
          if (entries[i].isDirectory()) { countDir(fp); }
          else { fileCount++; try { totalSize += fs.statSync(fp).size; } catch(e) {} }
        }
      } catch(e) {}
    }
    countDir(tempDir);
    return J(res, { fileCount: fileCount, totalSizeMB: Math.round(totalSize / 1048576 * 100) / 100 });
  }
  if (pn === '/api/temp/cleanup' && m === 'POST') {
    var tempDir = path.join(ROOT, 'temp');
    function rmDir(dir) {
      try {
        var entries = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          var fp = path.join(dir, entries[i].name);
          if (entries[i].isDirectory()) { rmDir(fp); try { fs.rmdirSync(fp); } catch(e) {} }
          else { try { fs.unlinkSync(fp); } catch(e) {} }
        }
      } catch(e) {}
    }
    rmDir(tempDir);
    fs.mkdirSync(tempDir, { recursive: true });
    return J(res, { ok: true, message: 'Temp folder cleaned' });
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

  // CLAUDE PERMISSION MODE
  if (pn === '/api/settings/permission-mode' && m === 'GET') {
    var sys = readJSON(path.join(ROOT, 'config/system.json')) || {};
    return J(res, { mode: sys.claudePermissionMode || 'autonomous' });
  }
  if (pn === '/api/settings/permission-mode' && m === 'PUT') {
    var b = await parseBody(req);
    var mode = b.mode;
    if (mode !== 'autonomous' && mode !== 'supervised') return E(res, 'Invalid mode. Use "autonomous" or "supervised".');
    var sp = path.join(ROOT, 'config/system.json');
    var sys = readJSON(sp) || {};
    sys.claudePermissionMode = mode;
    writeJSON(sp, sys);
    return J(res, { ok: true, mode: mode, note: 'New sessions will use this mode. Restart existing sessions to apply.' });
  }

  // SECRETS
  if (pn === '/api/secrets/status' && m === 'GET') {
    var exists = fs.existsSync(getSecretsFilePath());
    return J(res, { locked: secretsCache === null, count: secretsCache ? Object.keys(secretsCache).length : 0, exists: exists });
  }
  if (pn === '/api/secrets/unlock' && m === 'POST') {
    var b = await parseBody(req);
    if (!b.password) return E(res, 'Password required');
    try {
      var fileData = fs.readFileSync(getSecretsFilePath());
      var result = decryptSecrets(fileData, b.password);
      secretsCache = result.secrets;
      masterKeyCache = result.key;
      secretsSalt = result.salt;
      rebuildClaudeMd();
      return J(res, { ok: true, count: Object.keys(secretsCache).length });
    } catch(e) {
      return E(res, 'Invalid master password', 403);
    }
  }
  if (pn === '/api/secrets/lock' && m === 'POST') {
    secretsCache = null;
    masterKeyCache = null;
    secretsSalt = null;
    rebuildClaudeMd();
    broadcast('secrets');
    return J(res, { ok: true });
  }
  if (pn === '/api/secrets/change-password' && m === 'POST') {
    var b = await parseBody(req);
    if (!b.currentPassword || !b.newPassword) return E(res, 'Both passwords required');
    try {
      var fileData = fs.readFileSync(getSecretsFilePath());
      decryptSecrets(fileData, b.currentPassword); // verify current
    } catch(e) { return E(res, 'Current password is incorrect', 403); }
    secretsSalt = crypto.randomBytes(32);
    masterKeyCache = deriveKey(b.newPassword, secretsSalt);
    saveSecretsFile();
    return J(res, { ok: true });
  }

  var sm = pn.match(/^\/api\/secrets\/([^\/]+)$/);

  if (pn === '/api/secrets' && m === 'GET') {
    if (!secretsCache) return E(res, 'Secrets are locked', 403);
    var list = Object.keys(secretsCache).map(function(name) { return { name: name, maskedValue: maskValue(secretsCache[name]) }; });
    return J(res, { secrets: list });
  }
  if (pn === '/api/secrets' && m === 'POST') {
    var b = await parseBody(req);
    if (!b.name || !b.value) return E(res, 'Name and value required');
    var nameUpper = b.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Z_][A-Z0-9_]*$/.test(nameUpper)) return E(res, 'Invalid name format. Use UPPER_SNAKE_CASE.');
    // First-time setup: create vault
    if (!secretsCache) {
      if (!b.password) return E(res, 'Master password required to create vault');
      secretsSalt = crypto.randomBytes(32);
      masterKeyCache = deriveKey(b.password, secretsSalt);
      secretsCache = {};
    }
    secretsCache[nameUpper] = b.value;
    saveSecretsFile();
    rebuildClaudeMd();
    broadcast('secrets');
    return J(res, { ok: true });
  }
  if (sm && m === 'PUT' && !['status','unlock','lock','change-password'].includes(sm[1])) {
    if (!secretsCache) return E(res, 'Secrets are locked', 403);
    var name = sm[1];
    if (!secretsCache[name]) return E(res, 'Secret not found', 404);
    var b = await parseBody(req);
    if (!b.value) return E(res, 'Value required');
    secretsCache[name] = b.value;
    saveSecretsFile();
    broadcast('secrets');
    return J(res, { ok: true });
  }
  if (sm && m === 'DELETE' && !['status','unlock','lock','change-password'].includes(sm[1])) {
    if (!secretsCache) return E(res, 'Secrets are locked', 403);
    var name = sm[1];
    delete secretsCache[name];
    saveSecretsFile();
    if (Object.keys(secretsCache).length === 0) {
      try { fs.unlinkSync(getSecretsFilePath()); } catch(e) {}
      secretsCache = null; masterKeyCache = null; secretsSalt = null;
    }
    rebuildClaudeMd();
    broadcast('secrets');
    return J(res, { ok: true });
  }

  // AUTOPILOT
  if (pn === '/api/autopilot' && m === 'GET') {
    var schedules = readJSON(path.join(ROOT, 'config/autopilot.json')) || [];
    return J(res, schedules);
  }
  if (pn === '/api/autopilot' && m === 'POST') {
    var b = await parseBody(req);
    if (!b.name || !b.prompt || !b.agentId || !b.intervalMinutes) return E(res, 'name, prompt, agentId, and intervalMinutes required');
    var now = new Date();
    var schedule = {
      id: genId(),
      name: b.name,
      prompt: b.prompt,
      agentId: b.agentId,
      intervalMinutes: b.intervalMinutes,
      enabled: true,
      lastRun: null,
      nextRun: new Date(now.getTime() + b.intervalMinutes * 60000).toISOString(),
      createdAt: now.toISOString()
    };
    var schedules = readJSON(path.join(ROOT, 'config/autopilot.json')) || [];
    schedules.push(schedule);
    writeJSON(path.join(ROOT, 'config/autopilot.json'), schedules);
    broadcast('autopilot');
    return J(res, schedule, 201);
  }

  var apMatch = pn.match(/^\/api\/autopilot\/([^\/]+)$/);
  if (apMatch && m === 'PUT') {
    var apId = apMatch[1];
    var schedules = readJSON(path.join(ROOT, 'config/autopilot.json')) || [];
    var idx = schedules.findIndex(function(s) { return s.id === apId; });
    if (idx < 0) return E(res, 'Not found', 404);
    var b = await parseBody(req);
    var merged = Object.assign({}, schedules[idx], b, { id: apId });
    // If intervalMinutes changed and enabled, recompute nextRun
    if (b.intervalMinutes !== undefined && merged.enabled) {
      merged.nextRun = new Date(Date.now() + merged.intervalMinutes * 60000).toISOString();
    }
    schedules[idx] = merged;
    writeJSON(path.join(ROOT, 'config/autopilot.json'), schedules);
    broadcast('autopilot');
    return J(res, merged);
  }
  if (apMatch && m === 'DELETE') {
    var apId = apMatch[1];
    var schedules = readJSON(path.join(ROOT, 'config/autopilot.json')) || [];
    schedules = schedules.filter(function(s) { return s.id !== apId; });
    writeJSON(path.join(ROOT, 'config/autopilot.json'), schedules);
    broadcast('autopilot');
    return J(res, { ok: true });
  }

  // UPDATES
  if (pn === '/api/updates/check' && m === 'GET') {
    var result = await checkForUpdates();
    return J(res, result);
  }
  if (pn === '/api/updates/upgrade' && m === 'POST') {
    var result = await performUpgrade();
    broadcast('all');
    return J(res, result, result.success ? 200 : 400);
  }

  // SKILLS
  if (pn === '/api/skills' && m === 'GET') {
    var catalog = readJSON(path.join(ROOT, 'config/skills-catalog.json')) || [];
    var enabled = readJSON(path.join(ROOT, 'data/skills/enabled.json')) || {};
    var skills = catalog.map(function(s) {
      var deps = (s.systemDeps || []).map(function(dep) {
        return { name: dep, installed: commandExists(dep) };
      });
      var missingDeps = deps.filter(function(d) { return !d.installed; }).map(function(d) { return d.name; });
      var settingValues = {};
      if (s.settings && s.settings.length) {
        var sv = readJSON(path.join(ROOT, 'data/skills', s.id + '-settings.json'));
        if (sv) {
          // Mask secret values for display
          s.settings.forEach(function(setting) {
            if (sv[setting.key]) {
              settingValues[setting.key] = setting.type === 'secret' ? '********' : sv[setting.key];
            }
          });
        }
      }
      return Object.assign({}, s, {
        enabled: !!enabled[s.id],
        depsStatus: deps,
        missingDeps: missingDeps,
        settingValues: settingValues
      });
    });
    return J(res, { skills: skills });
  }

  // Skill settings
  var skillSettingsMatch = pn.match(/^\/api\/skills\/([^\/]+)\/settings$/);
  if (skillSettingsMatch && m === 'PUT') {
    var ssId = skillSettingsMatch[1];
    var b = await parseBody(req);
    var settingsPath = path.join(ROOT, 'data/skills', ssId + '-settings.json');
    var existing = readJSON(settingsPath) || {};
    // Merge — don't overwrite with masked values
    for (var key in b) {
      if (b[key] && b[key] !== '********') existing[key] = b[key];
    }
    writeJSON(settingsPath, existing);

    // Update .mcp.json env vars with actual values
    var catalog = readJSON(path.join(ROOT, 'config/skills-catalog.json')) || [];
    var skill = catalog.find(function(s) { return s.id === ssId; });
    if (skill && skill.type === 'mcp' && skill.mcpConfig && skill.mcpConfig.env) {
      var mcpPath = path.join(ROOT, '.mcp.json');
      var mcpData = readJSON(mcpPath) || { mcpServers: {} };
      if (mcpData.mcpServers[ssId]) {
        var env = {};
        for (var envKey in skill.mcpConfig.env) {
          var tmpl = skill.mcpConfig.env[envKey];
          var match = tmpl.match(/^\$\{(.+)\}$/);
          env[envKey] = match && existing[match[1]] ? existing[match[1]] : tmpl;
        }
        mcpData.mcpServers[ssId].env = env;
        writeJSON(mcpPath, mcpData);
      }
    }

    broadcast('skills');
    return J(res, { ok: true });
  }

  var skillMatch = pn.match(/^\/api\/skills\/([^\/]+)\/(enable|disable)$/);
  if (skillMatch && m === 'POST') {
    var skillId = skillMatch[1];
    var action = skillMatch[2];
    var catalog = readJSON(path.join(ROOT, 'config/skills-catalog.json')) || [];
    var skill = catalog.find(function(s) { return s.id === skillId; });
    if (!skill) return E(res, 'Skill not found', 404);

    var enabledPath = path.join(ROOT, 'data/skills/enabled.json');
    var enabled = readJSON(enabledPath) || {};

    if (action === 'enable') {
      // Step 1: Check and install system dependencies
      var systemDeps = skill.systemDeps || [];
      var depResults = [];
      var depFailed = false;

      for (var i = 0; i < systemDeps.length; i++) {
        var dep = systemDeps[i];
        if (commandExists(dep)) {
          depResults.push({ dep: dep, status: 'already_installed' });
        } else {
          // Try to auto-install
          var installRes = installSystemDep(dep);
          depResults.push({ dep: dep, status: installRes.success ? 'installed' : 'failed', output: installRes.output });
          if (!installRes.success) depFailed = true;
        }
      }

      if (depFailed) {
        var missing = depResults.filter(function(r) { return r.status === 'failed'; });
        var missingNames = missing.map(function(r) { return r.dep; }).join(', ');
        var details = missing.map(function(r) { return r.dep + ': ' + r.output; }).join('\n');
        return J(res, {
          ok: false,
          error: 'Missing system dependencies: ' + missingNames,
          details: details,
          depResults: depResults
        }, 500);
      }

      // Step 2: Ensure npm is available
      if (!commandExists('npm')) {
        return J(res, { ok: false, error: 'npm is not installed. Please install Node.js from https://nodejs.org' }, 500);
      }

      // Step 3: Install npm packages (for npm-based skills)
      if (skill.packages && skill.packages.length > 0) {
        var installResult = await new Promise(function(resolve) {
          var args = ['install', '--save'].concat(skill.packages);
          var proc = spawn('npm', args, { cwd: ROOT, shell: true, timeout: 120000 });
          var output = '';
          proc.stdout.on('data', function(ch) { output += ch; });
          proc.stderr.on('data', function(ch) { output += ch; });
          proc.on('close', function(code) {
            resolve({ success: code === 0, output: output });
          });
          proc.on('error', function(err) {
            resolve({ success: false, output: err.message });
          });
        });

        if (!installResult.success) {
          var npmOutput = installResult.output || '';
          var hint = '';
          if (npmOutput.match(/gyp ERR|node-gyp|python/i)) {
            hint = ' You may need Python installed for native module compilation.';
            if (!commandExists('python') && !commandExists('python3')) {
              hint += ' Python was not found on your system — installing it may fix this.';
            }
          }
          if (npmOutput.match(/EACCES|permission denied/i)) {
            hint = ' Try running with administrator/sudo privileges.';
          }
          if (npmOutput.match(/ENOTFOUND|network|ETIMEDOUT/i)) {
            hint = ' Check your internet connection.';
          }
          return J(res, { ok: false, error: 'npm install failed.' + hint, output: npmOutput }, 500);
        }
      }

      // Step 3b: Git-based skills — clone repo and build
      if (skill.gitRepo) {
        var skillDir = path.join(ROOT, 'data/skills', skill.id);
        fs.mkdirSync(skillDir, { recursive: true });

        // Clone if not already cloned
        if (!fs.existsSync(path.join(skillDir, '.git'))) {
          var cloneResult = await new Promise(function(resolve) {
            var proc = spawn('git', ['clone', skill.gitRepo, '.'], { cwd: skillDir, shell: true, timeout: 120000 });
            var output = '';
            proc.stdout.on('data', function(ch) { output += ch; });
            proc.stderr.on('data', function(ch) { output += ch; });
            proc.on('close', function(code) { resolve({ success: code === 0, output: output }); });
            proc.on('error', function(err) { resolve({ success: false, output: err.message }); });
          });
          if (!cloneResult.success) {
            return J(res, { ok: false, error: 'Git clone failed.', details: cloneResult.output }, 500);
          }
        }

        // Build
        if (skill.buildCmd) {
          var buildResult = await new Promise(function(resolve) {
            var proc = spawn(skill.buildCmd, [], { cwd: skillDir, shell: true, timeout: 180000 });
            var output = '';
            proc.stdout.on('data', function(ch) { output += ch; });
            proc.stderr.on('data', function(ch) { output += ch; });
            proc.on('close', function(code) { resolve({ success: code === 0, output: output }); });
            proc.on('error', function(err) { resolve({ success: false, output: err.message }); });
          });
          if (!buildResult.success) {
            return J(res, { ok: false, error: 'Build failed.', details: buildResult.output }, 500);
          }
        }
      }

      // For MCP skills: write to .mcp.json
      if (skill.type === 'mcp' && skill.mcpConfig) {
        var mcpPath = path.join(ROOT, '.mcp.json');
        var mcpData = readJSON(mcpPath) || { mcpServers: {} };
        // Resolve env vars from secrets for git-based skills
        var mcpEntry = JSON.parse(JSON.stringify(skill.mcpConfig));
        if (skill.gitRepo && mcpEntry.args) {
          mcpEntry.args = mcpEntry.args.map(function(a) {
            return a.replace(/^data\/skills\//, path.join(ROOT, 'data/skills/').replace(/\\/g, '/') + '/').replace(/\\/g, '/');
          });
        }
        mcpData.mcpServers[skill.id] = mcpEntry;
        writeJSON(mcpPath, mcpData);
      }

      // For CLI skills: ensure data/skills/<id>/ directory
      if (skill.type === 'cli') {
        fs.mkdirSync(path.join(ROOT, 'data/skills', skill.id), { recursive: true });
      }

      enabled[skillId] = true;
      writeJSON(enabledPath, enabled);
      broadcast('skills');
      return J(res, { ok: true, installed: true });

    } else {
      // Disable
      // For MCP skills: remove from .mcp.json
      if (skill.type === 'mcp') {
        var mcpPath = path.join(ROOT, '.mcp.json');
        var mcpData = readJSON(mcpPath) || { mcpServers: {} };
        delete mcpData.mcpServers[skill.id];
        writeJSON(mcpPath, mcpData);
      }

      enabled[skillId] = false;
      writeJSON(enabledPath, enabled);
      broadcast('skills');
      return J(res, { ok: true });
    }
  }

  // SCREEN RECORDER CONTROL
  var recMatch = pn.match(/^\/api\/skills\/screen-recorder\/(start|stop|status)$/);
  if (recMatch) {
    var recAction = recMatch[1];
    var recScript = path.join(ROOT, 'data/skills/screen-recorder/record.js');
    if (!fs.existsSync(recScript)) return E(res, 'Screen recorder not installed', 404);

    var recArgs = [recScript, recAction];
    // For start, pass through query params as flags
    if (recAction === 'start' && m === 'POST') {
      var body = await new Promise(function(resolve) {
        var d = ''; req.on('data', function(c) { d += c; }); req.on('end', function() {
          try { resolve(JSON.parse(d)); } catch(e) { resolve({}); }
        });
      });
      if (body.fps) recArgs.push('--fps', String(body.fps));
      if (body.output) recArgs.push('--output', String(body.output));
      if (body.window) recArgs.push('--window', String(body.window));
      if (body.region) recArgs.push('--region', String(body.region));
    }

    var recResult = await new Promise(function(resolve) {
      var proc = spawn('node', recArgs, { cwd: ROOT, shell: true, timeout: 10000 });
      var output = '';
      proc.stdout.on('data', function(ch) { output += ch; });
      proc.stderr.on('data', function(ch) { output += ch; });
      proc.on('close', function(code) {
        try { resolve(JSON.parse(output)); } catch(e) { resolve({ ok: code === 0, output: output }); }
      });
      proc.on('error', function(err) {
        resolve({ ok: false, error: err.message });
      });
    });

    return J(res, recResult, recResult.error ? 500 : 200);
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

  // MEDIA FILE SERVING
  if (pn.startsWith('/api/media/files/') && m === 'GET') {
    const filename = decodeURIComponent(pn.slice('/api/media/files/'.length));
    if (filename.indexOf('..') >= 0 || filename.indexOf('/') >= 0 || filename.indexOf('\\') >= 0) {
      res.writeHead(403); return res.end('Forbidden');
    }
    const filePath = path.join(ROOT, 'data', 'media', filename);
    if (!filePath.startsWith(path.join(ROOT, 'data', 'media'))) {
      res.writeHead(403); return res.end('Forbidden');
    }
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filename).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      return res.end(data);
    } catch(e) { res.writeHead(404); return res.end('Not found'); }
  }

  // OPEN MEDIA FOLDER
  if (pn === '/api/media/open-folder' && m === 'POST') {
    const b = await parseBody(req);
    if (!b.filename) return E(res, 'filename required');
    const filename = b.filename;
    if (filename.indexOf('..') >= 0 || filename.indexOf('/') >= 0 || filename.indexOf('\\') >= 0) {
      return E(res, 'Invalid filename', 403);
    }
    const filePath = path.join(ROOT, 'data', 'media', filename);
    if (!fs.existsSync(filePath)) return E(res, 'File not found', 404);
    try {
      const plat = process.platform;
      if (plat === 'win32') {
        execSync('explorer /select,"' + filePath.replace(/\//g, '\\') + '"');
      } else if (plat === 'darwin') {
        execSync('open -R "' + filePath + '"');
      } else {
        execSync('xdg-open "' + path.dirname(filePath) + '"');
      }
    } catch(e) { /* explorer returns non-zero sometimes, ignore */ }
    return J(res, { ok: true });
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
  var staticPath = pn === '/' ? '/index.html' : pn;
  staticPath = path.join(BASE, staticPath);
  if (!staticPath.startsWith(BASE)) { res.writeHead(403); return res.end('Forbidden'); }
  var ext = path.extname(staticPath).toLowerCase();
  fs.readFile(staticPath, function(e, data) {
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
function doWsHandshake(req, socket) {
  var key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }
  var accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  return true;
}

server.on('upgrade', function(req, socket, head) {
  var urlObj = new URL(req.url, 'http://localhost');
  var pathname = urlObj.pathname;

  if (pathname === '/ws/terminal') {
    // ── Terminal WebSocket ──
    if (!doWsHandshake(req, socket)) return;

    var sessionId = urlObj.searchParams.get('session') || genId();
    var termSessionId = sessionId; // capture for closures
    var buf = Buffer.alloc(0);

    // Try to reattach or create new
    var session = termSessions.get(sessionId);
    if (session) {
      reattachTermSession(sessionId, socket);
      wsSend(socket, { type: 'terminal-ready', session: sessionId, reattached: true });
    } else {
      session = createTermSession(sessionId, socket);
      if (session) {
        wsSend(socket, { type: 'terminal-ready', session: sessionId, reattached: false });
      }
    }

    socket.on('data', function(data) {
      buf = Buffer.concat([buf, data]);
      while (buf.length > 0) {
        var frame = parseWsFrame(buf);
        if (!frame) break;
        buf = buf.slice(frame.totalLen);

        if (frame.opcode === 0x8) {
          // Detach session on close (keep PTY alive)
          detachTermSession(termSessionId);
          try {
            var closeFrame = Buffer.alloc(2);
            closeFrame[0] = 0x88; closeFrame[1] = 0;
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
            var s = termSessions.get(termSessionId);
            if (msg.type === 'input' && s && s.pty) {
              s.pty.write(msg.data);
            } else if (msg.type === 'resize' && s && s.pty) {
              try { s.pty.resize(msg.cols || 120, msg.rows || 30); } catch(e) {}
            } else if (msg.type === 'restart') {
              // Kill existing, create new
              if (s) { try { s.pty.kill(); } catch(e) {} termSessions.delete(termSessionId); }
              termSessionId = genId();
              var newSession = createTermSession(termSessionId, socket);
              if (newSession) {
                wsSend(socket, { type: 'terminal-ready', session: termSessionId, reattached: false });
              }
            }
          } catch(e) {}
        }
      }
    });

    socket.on('close', function() { detachTermSession(termSessionId); });
    socket.on('error', function() { detachTermSession(termSessionId); });
    return;
  }

  if (pathname === '/ws') {
    // ── Dashboard refresh WebSocket (unchanged) ──
    if (!doWsHandshake(req, socket)) return;

    wsClients.add(socket);
    var buf = Buffer.alloc(0);

    socket.on('data', function(data) {
      buf = Buffer.concat([buf, data]);
      while (buf.length > 0) {
        var frame = parseWsFrame(buf);
        if (!frame) break;
        buf = buf.slice(frame.totalLen);

        if (frame.opcode === 0x8) {
          wsClients.delete(socket);
          try {
            var closeFrame = Buffer.alloc(2);
            closeFrame[0] = 0x88; closeFrame[1] = 0;
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
      }
    });

    socket.on('close', function() { wsClients.delete(socket); });
    socket.on('error', function() { wsClients.delete(socket); });
    return;
  }

  socket.destroy();
});

// ── Autopilot Scheduler Engine ───────────────────────────
setInterval(function() {
  var schedules = readJSON(path.join(ROOT, 'config/autopilot.json'));
  if (!schedules || !schedules.length) return;
  var now = new Date();
  var changed = false;
  schedules.forEach(function(sched) {
    if (!sched.enabled || !sched.nextRun) return;
    if (new Date(sched.nextRun) > now) return;

    // Find an active terminal PTY session to write to
    var sentTo = null;
    termSessions.forEach(function(session, sid) {
      if (sentTo) return;
      if (session.pty) {
        var prompt = sched.prompt;
        if (sched.agentId !== 'orchestrator') {
          // Resolve agent name from registry
          var reg = readJSON(path.join(ROOT, 'agents/_registry.json')) || { agents: [] };
          var agent = reg.agents.find(function(a) { return a.id === sched.agentId; });
          var agentName = agent ? agent.name : sched.agentId;
          prompt = 'Work as agent ' + agentName + ' (ID: ' + sched.agentId + '): ' + prompt;
        }
        session.pty.write(prompt + '\r');
        sentTo = sid;
      }
    });

    // Update timing regardless of whether a terminal was found
    sched.lastRun = now.toISOString();
    sched.nextRun = new Date(now.getTime() + sched.intervalMinutes * 60000).toISOString();
    changed = true;
  });
  if (changed) {
    writeJSON(path.join(ROOT, 'config/autopilot.json'), schedules);
    broadcast('autopilot');
  }
}, 60000);

// ── Startup ──────────────────────────────────────────────
fs.mkdirSync(path.join(ROOT, 'data/knowledge'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'temp'), { recursive: true });

// Auto-cleanup stale temp files if configured
(function() {
  var sys = readJSON(path.join(ROOT, 'config/system.json')) || {};
  var days = sys.tempAutoCleanupDays;
  if (days && typeof days === 'number' && days > 0) {
    var tempDir = path.join(ROOT, 'temp');
    try {
      var cutoff = Date.now() - days * 86400000;
      function cleanDir(dir) {
        var entries = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          var fp = path.join(dir, entries[i].name);
          if (entries[i].isDirectory()) {
            cleanDir(fp);
            try { fs.rmdirSync(fp); } catch(e) {}
          } else {
            try {
              var st = fs.statSync(fp);
              if (st.mtimeMs < cutoff) fs.unlinkSync(fp);
            } catch(e) {}
          }
        }
      }
      cleanDir(tempDir);
    } catch(e) { console.log('  Temp auto-cleanup skipped:', e.message); }
  }
})();

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
