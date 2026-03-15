const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

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
    '- `data/media/` \u2014 Shared media library\n\n' +
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
