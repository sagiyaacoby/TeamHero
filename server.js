const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const net = require('net');

// ── Bootstrap Self-Heal ──────────────────────────────────
// If lib/ is missing (old upgrade code didn't extract it),
// re-download from the release tarball for the current version.
(function bootstrapSelfHeal() {
  var libDir = path.join(__dirname, 'lib');
  if (fs.existsSync(libDir)) return; // lib/ exists, nothing to do

  console.log('  Bootstrap: lib/ directory missing - attempting self-heal...');
  try {
    var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    var version = pkg.version || '0.0.0';
    var repo = 'sagiyaacoby/TeamHero';
    var url = 'https://api.github.com/repos/' + repo + '/tarball/v' + version;

    console.log('  Bootstrap: Downloading v' + version + ' tarball...');

    // Write a temporary download script and run it synchronously
    var tmpScript = path.join(__dirname, '_bootstrap_tmp.js');
    var scriptContent = [
      'var https = require("https");',
      'var zlib = require("zlib");',
      'var fs = require("fs");',
      'var path = require("path");',
      'var root = process.argv[2];',
      'var url = process.argv[3];',
      '',
      'function download(url, cb) {',
      '  https.get(url, { headers: { "User-Agent": "TeamHero-Bootstrap" } }, function(res) {',
      '    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {',
      '      return download(res.headers.location, cb);',
      '    }',
      '    if (res.statusCode !== 200) return cb(new Error("HTTP " + res.statusCode));',
      '    var chunks = [];',
      '    res.on("data", function(c) { chunks.push(c); });',
      '    res.on("end", function() { cb(null, Buffer.concat(chunks)); });',
      '  }).on("error", cb);',
      '}',
      '',
      'download(url, function(err, gzData) {',
      '  if (err) { console.error("Download failed: " + err.message); process.exit(1); }',
      '  var tarData = zlib.gunzipSync(gzData);',
      '  var offset = 0, stripPrefix = "", extracted = 0;',
      '  var extractDirs = ["lib/", "migrations/"];',
      '  while (offset < tarData.length) {',
      '    var header = tarData.slice(offset, offset + 512);',
      '    if (header.length < 512 || header[0] === 0) break;',
      '    var fileName = header.slice(0, 100).toString("utf8").replace(/\\0/g, "");',
      '    var prefix = header.slice(345, 500).toString("utf8").replace(/\\0/g, "");',
      '    if (prefix) fileName = prefix + "/" + fileName;',
      '    var sizeOctal = header.slice(124, 136).toString("utf8").replace(/\\0/g, "").trim();',
      '    var fileSize = parseInt(sizeOctal, 8) || 0;',
      '    var typeFlag = header[156];',
      '    offset += 512;',
      '    if (!stripPrefix && fileName.indexOf("/") > 0) {',
      '      stripPrefix = fileName.slice(0, fileName.indexOf("/") + 1);',
      '    }',
      '    var relPath = fileName;',
      '    if (stripPrefix && relPath.startsWith(stripPrefix)) {',
      '      relPath = relPath.slice(stripPrefix.length);',
      '    }',
      '    if (relPath && fileSize > 0 && typeFlag === 48) {',
      '      var shouldExtract = extractDirs.some(function(d) { return relPath.startsWith(d); });',
      '      if (shouldExtract) {',
      '        var fileData = tarData.slice(offset, offset + fileSize);',
      '        var destPath = path.join(root, relPath);',
      '        fs.mkdirSync(path.dirname(destPath), { recursive: true });',
      '        fs.writeFileSync(destPath, fileData);',
      '        extracted++;',
      '      }',
      '    }',
      '    offset += Math.ceil(fileSize / 512) * 512;',
      '  }',
      '  console.log("  Bootstrap: Extracted " + extracted + " files");',
      '});',
    ].join('\n');

    fs.writeFileSync(tmpScript, scriptContent);
    try {
      execSync('node "' + tmpScript + '" "' + __dirname + '" "' + url + '"', {
        stdio: 'inherit',
        timeout: 60000,
      });
    } finally {
      // Clean up temp script
      try { fs.unlinkSync(tmpScript); } catch(e2) {}
    }

    if (!fs.existsSync(libDir)) {
      throw new Error('lib/ still missing after extraction');
    }
    console.log('  Bootstrap: Self-heal complete.');
  } catch(e) {
    console.error('  Bootstrap: Self-heal failed: ' + e.message);
    console.error('  Please manually download the latest release from https://github.com/sagiyaacoby/TeamHero/releases');
    process.exit(1);
  }
})();

// ── Extracted Modules ────────────────────────────────────
const { parseWsFrame, buildWsFrame, wsSend } = require('./lib/websocket');
const { commandExists } = require('./lib/skills');
const upgrade = require('./lib/upgrade');
const skills = require('./lib/skills');
const ptyMod = require('./lib/pty');
const migrations = require('./lib/migrations');
const health = require('./lib/health');

const BASE = path.join(__dirname, 'portal');
const ROOT = __dirname;

function getConfiguredPort() {
  try {
    var sys = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/system.json'), 'utf8'));
    if (sys.port) return sys.port;
  } catch(e) {}
  return null;
}

function isPortFree(port) {
  return new Promise(function(resolve) {
    var srv = net.createServer();
    srv.once('error', function() { resolve(false); });
    srv.once('listening', function() { srv.close(function() { resolve(true); }); });
    srv.listen(port);
  });
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

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var s = path.join(src, entries[i].name);
    var d = path.join(dest, entries[i].name);
    if (entries[i].isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function dirSize(dir) {
  var total = 0;
  try {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var fp = path.join(dir, entries[i].name);
      if (entries[i].isDirectory()) total += dirSize(fp);
      else try { total += fs.statSync(fp).size; } catch(e) {}
    }
  } catch(e) {}
  return total;
}

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    let body = '';
    req.on('data', function(ch) { body += ch; if (body.length > 20e6) { req.destroy(); reject(new Error('Too large')); } });
    req.on('end', function() { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
  });
}

function J(res, data, s) { s=s||200; res.writeHead(s, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); }
function E(res, msg, s) { J(res, {error:msg}, s||400); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

// ── Task Lifecycle Constants ─────────────────────────────
var VALID_STATUSES = ['planning', 'pending_approval', 'accepted', 'in_progress', 'done', 'closed', 'revision_needed', 'hold', 'cancelled'];

var VALID_TRANSITIONS = {
  planning:          ['pending_approval', 'in_progress', 'hold', 'cancelled'],
  pending_approval:  ['accepted', 'revision_needed', 'hold', 'cancelled', 'closed'],
  accepted:          ['in_progress', 'hold', 'cancelled'],
  in_progress:       ['pending_approval', 'done', 'hold', 'cancelled'],
  done:              ['closed'],
  closed:            [],  // terminal
  revision_needed:   ['in_progress', 'pending_approval', 'hold', 'cancelled'],
  hold:              ['planning', 'in_progress', 'pending_approval', 'closed', 'cancelled'],
  cancelled:         []   // terminal
};

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
  var keys = Object.keys(secretsCache).filter(function(k) { return k !== '_credentials'; });
  for (var i = 0; i < keys.length; i++) {
    var val = secretsCache[keys[i]];
    if (val && val.length >= 4) {
      var escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
  }
  // Also scrub credential passwords
  var creds = getCredentials();
  for (var ci = 0; ci < creds.length; ci++) {
    var pw = creds[ci].password;
    if (pw && pw.length >= 4) {
      var escaped = pw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (secretsCache) return Object.keys(secretsCache).filter(function(k) { return k !== '_credentials'; });
  return [];
}

function getCredentials() {
  if (!secretsCache) return [];
  return secretsCache._credentials || [];
}

function getCredentialEnvNames() {
  var creds = getCredentials();
  var names = [];
  for (var i = 0; i < creds.length; i++) {
    var prefix = creds[i].service.toUpperCase().replace(/[\s\-]+/g, '_').replace(/[^A-Z0-9_]/g, '');
    names.push(prefix + '_USERNAME');
    names.push(prefix + '_PASSWORD');
  }
  return names;
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
  const capsMd = readText(path.join(ROOT, 'config/capabilities.md')) || '';
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

  var port = PORT || getConfiguredPort() || 3796;

  const md = '# ' + tn + ' \u2014 Orchestrator Context\n\n' +
    '> **Auto-generated file.** Do not edit manually. Regenerated when config changes.\n\n' +
    '## Identity\n\n' +
    'You are the **orchestrator** of the "' + tn + '" team.\n' +
    'Your job is to coordinate all agents, manage tasks, run round tables, and serve the team owner.\n\n' +
    '## Startup Checks\n\n' +
    'On every new CLI session, FIRST run: `curl -s http://localhost:' + port + '/api/health`\n\n' +
    'If `upgradePending` is not null:\n' +
    '1. Report to owner: "System upgraded from v{previousVersion} to v{version}"\n' +
    '2. Check `status` and `issues` - report any warnings or errors\n' +
    '3. Self-heal if possible:\n' +
    '   - "claude-md" issue: `curl -X POST http://localhost:' + port + '/api/rebuild-context`\n' +
    '   - "agent-os" / "agent-md" / "agent-folder" issue: delegate to Dev\n' +
    '   - "migration-failed" / "interrupted-upgrade": report to owner, suggest rollback\n' +
    '   - "directory" issues: already auto-created by health check\n' +
    '4. Clear flag: `curl -X POST http://localhost:' + port + '/api/health/clear-upgrade`\n' +
    '5. Confirm: "Post-upgrade health check complete. All systems operational."\n\n' +
    'If `upgradePending` is null: skip. Only run health checks on owner request or during round tables.\n\n' +
    '## HARD RULE: Orchestrator Bash Restrictions\n\n' +
    'The orchestrator may ONLY use the Bash tool for `curl` calls to `http://localhost:' + port + '/api/...`.\n' +
    'ALL other bash commands (git, cp, rm, mv, node, file edits, etc.) MUST be delegated to agents via tasks.\n\n' +
    '### Before ANY Bash command, ask yourself:\n\n' +
    '1. Is this a `curl` command to `http://localhost:' + port + '/api/...`? If NO -> STOP.\n' +
    '2. Am I about to run git, cp, rm, mv, node, or any non-curl command? If YES -> STOP and create a task.\n' +
    '3. Could this work be done by an agent (Dev, Scout, Shipper, Pen, Buzz)? If YES -> delegate it.\n\n' +
    '### Violation examples (NEVER do these directly):\n\n' +
    '| Forbidden Action | Delegate To |\n' +
    '|---|---|\n' +
    '| Copying/moving files | Dev |\n' +
    '| Deleting GitHub releases/tags | Shipper |\n' +
    '| Git operations (commit, push, tag, branch) | Shipper |\n' +
    '| Reading/exploring code files | Scout |\n' +
    '| Editing any file (code, config, content) | Dev or Pen |\n' +
    '| Running node scripts | Dev |\n\n' +
    '### The ONLY exception:\n\n' +
    '`curl` to `http://localhost:' + port + '/api/...` for task management, agent management, memory updates, and status checks.\n' +
    'This is the orchestrator\'s tool for coordination - everything else is agent work.\n\n' +
    '## Owner Profile\n\n' + (ownerMd || '_No owner profile configured yet._') + '\n\n' +
    '## Active Agents\n\n' + (al || '_No agents registered yet._') + '\n\n' +
    '### How to Work as an Agent\n\n' +
    'Use Claude Code\'s **Agent tool** to delegate work to subagents. Never do agent work yourself.\n\n' +
    'When the owner asks you to perform work that matches a specific agent\'s role:\n' +
    '1. Launch a subagent via the **Agent tool** with a prompt that includes:\n' +
    '   - FIRST: "Read the Platform OS at `config/agent-os.md` - these are your operational rules"\n' +
    '   - The agent identity: "You are {name}, read your definition at `agents/{id}/agent.md`"\n' +
    '   - Memory files to read: `agents/{id}/short-memory.md` and `agents/{id}/long-memory.md`\n' +
    '   - The task to execute and its ID\n' +
    '   - The API base URL: `http://localhost:' + port + '`\n' +
    '   - Instructions to: adopt the agent persona, execute the work, update task status via API, update agent memory when done\n' +
    '2. For independent tasks, launch **multiple Agent tool calls in one message** for parallel execution\n' +
    '3. Use `run_in_background: true` for tasks that don\'t need immediate results\n' +
    '4. Each subagent has full tool access (Read, Edit, Write, Bash, Grep, Glob)\n\n' +
    '### On-Demand Context Loading\n\n' +
    'Only include extra context files when the task genuinely needs them:\n' +
    '- **Subtask/complex planning**: add `config/team-rules.md` (full task structure rules)\n' +
    '- **External posting/communications**: add `config/security-rules.md`\n' +
    '- **Agent needs work history**: add `agents/{id}/work-log.md`\n' +
    '- **Migration tasks**: add migration system docs\n' +
    '- **Platform feature questions**: add `config/capabilities.md`\n\n' +
    'Do NOT load these by default. The OS layer covers all critical rules.\n\n' +
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
    '- **Create task:** `POST /api/tasks` with `{"title","description","assignedTo","status":"planning","priority":"medium","type":"general","autopilot":false}`\n' +
    '  - Supported types: `general`, `research`, `development`, `content`, `review`, `operations`\n' +
    '  - Optional: `parentTaskId`, `dependsOn: []` for subtask/dependency relationships\n' +
    '- **Update task:** `PUT /api/tasks/{id}` with JSON body (partial update, e.g. `{"status":"closed"}`)\n' +
    '  - Actions: `{"action":"accept"}`, `{"action":"close"}`, `{"action":"improve","comments":"..."}`, `{"action":"hold"}`, `{"action":"cancel"}`\n' +
    '  - Blocker: `{"blocker":"reason"}` to set, `{"blocker":null}` to clear (auto-logs to progress)\n' +
    '- **Create subtask:** `POST /api/tasks/{parentId}/subtasks` with task body (auto-links to parent)\n' +
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
    'When asked to build a team or add agents, create each via `POST /api/agents` with distinct role, personality, mission, rules, and capabilities. Never write agent files directly. Summarize the team to the owner when done.\n\n' +

    '## Team Rules\n\n' + teamR + '\n\n' +
    '## Security Rules\n\n' + secR + '\n\n' +
    '## Safety Boundaries\n\n' +
    'CRITICAL: These rules are enforced at all times regardless of permission mode.\n\n' +
    (function() {
      var sys = readJSON(path.join(ROOT, 'config/system.json')) || {};
      var paths = sys.localAccess || [ROOT.replace(/\\/g, '/')];
      if (paths.length <= 1) {
        return '- **Project folder only:** ALL file operations (read, write, delete) must stay within `' + ROOT.replace(/\\/g, '/') + '/`. Never access files outside this directory.\n';
      }
      return '- **Allowed folders only:** ALL file operations (read, write, delete) must stay within these directories (including subfolders). Never access files outside them.\n' +
        paths.map(function(p) { return '  - `' + p + '/`\n'; }).join('');
    })() +
    '- **Never modify platform files:** Do not edit `server.js`, `portal/`, `launch.bat`, `launch.sh`, or `package.json`. These are managed by the upgrade system.\n' +
    '- **Never expose secrets:** Environment variables containing API keys or tokens must never be echoed, logged, written to files, or included in any output. Use them only as pass-through in commands.\n' +
    '- **No destructive system commands:** Do not run commands that affect the OS, other processes, or network infrastructure (e.g. `rm -rf /`, `shutdown`, `format`, `kill`, `netsh`).\n' +
    '- **No external communications without approval:** Do not send emails, post to APIs, push to git, or make any external network calls unless the owner explicitly requests it.\n\n' +
    '## Shell Environment\n\n' +
    '- Only `node` is guaranteed to be available. Do not assume `python3`, `python`, or other runtimes are installed.\n' +
    '- To parse JSON in shell commands, use `node -e` instead of `python3 -c`.\n' +
    '- Example: `curl -s url | node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"`\n\n' +
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
    (capsMd ? '## Capabilities\n\n' + capsMd + '\n\n' : '') +
    (function() {
      var sc = skills.getEnabledSkillContexts({ ROOT: ROOT, readJSON: readJSON, path: path });
      return sc ? '## Enabled Skills\n\n' + sc + '\n\n' : '';
    })() +
    '## Available Secrets\n\n' +
    'These environment variables are injected into your session when secrets are unlocked:\n\n' +
    (function() {
      var names = getSecretNames();
      var credNames = getCredentialEnvNames();
      var allNames = names.concat(credNames);
      if (allNames.length === 0) return '_No secrets configured. Add them via dashboard Settings > Secrets & API Keys._\n';
      return allNames.map(function(n) { return '- `$' + n + '`'; }).join('\n') + '\n\n' +
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
    '- Short: `agents/' + aid + '/short-memory.md`\n' +
    '- Long: `agents/' + aid + '/long-memory.md`\n';
  writeText(path.join(ROOT, 'agents', aid, 'agent.md'), md);
}

// ── WebSocket Helpers (from lib/websocket.js) ────────────

// ── Upgrade / Update (from lib/upgrade.js) ───────────────

// ── PTY Terminal (from lib/pty.js) ────────────────────────
var termSessions = ptyMod.getTermSessions();

// Restart PTY sessions with updated secrets (called after vault unlock / secret changes)
function syncSecretsToTerminals() {
  ptyMod.injectSecretsIntoTerminals(sharedCtx);
}

// ── Shared Context for Extracted Modules ─────────────────
var sharedCtx = {
  ROOT: ROOT,
  path: path,
  fs: fs,
  readJSON: readJSON,
  writeJSON: writeJSON,
  readText: readText,
  writeText: writeText,
  broadcast: broadcast,
  wsSend: wsSend,
  parseWsFrame: parseWsFrame,
  scrubSecrets: scrubSecrets,
  getSecretNames: getSecretNames,
  getCredentials: getCredentials,
  get secretsCache() { return secretsCache; },
  genId: genId,
  rebuildClaudeMd: function() { rebuildClaudeMd(); },
};

// ── Request Handler ──────────────────────────────────────
async function handle(pn, m, req, res) {
  // SYSTEM
  if (pn === '/api/system/status' && m === 'GET')
    return J(res, readJSON(path.join(ROOT, 'config/system.json')) || { initialized: false });
  if (pn === '/api/system/initialize' && m === 'POST') {
    const sp = path.join(ROOT, 'config/system.json');
    const s = readJSON(sp) || {};
    // On first initialization, clean out any shipped/leftover sub-agents
    if (!s.initialized) {
      const rp = path.join(ROOT, 'agents/_registry.json');
      const rg = readJSON(rp) || { agents: [] };
      rg.agents.forEach(function(a) {
        if (a.isOrchestrator) return;
        const dir = path.join(ROOT, 'agents', a.id);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      });
      rg.agents = rg.agents.filter(function(a) { return a.isOrchestrator; });
      writeJSON(rp, rg);
    }
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

  // GLOBAL AUTOPILOT CONFIG
  if (pn === '/api/config/autopilot' && m === 'GET') {
    var sys = readJSON(path.join(ROOT, 'config/system.json')) || {};
    return J(res, { enabled: sys.globalAutopilot === true });
  }
  if (pn === '/api/config/autopilot' && m === 'PUT') {
    const b = await parseBody(req);
    var sysCfg = readJSON(path.join(ROOT, 'config/system.json')) || {};
    sysCfg.globalAutopilot = b.enabled === true;
    writeJSON(path.join(ROOT, 'config/system.json'), sysCfg);
    broadcast('config');
    return J(res, { enabled: sysCfg.globalAutopilot });
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

  // AGENT FILES - list all files produced by an agent across tasks
  const afm = pn.match(/^\/api\/agents\/([^\/]+)\/files$/);
  if (afm && m === 'GET') {
    const agentId = afm[1];
    const idx = readJSON(path.join(ROOT, 'data/tasks/_index.json')) || { tasks: [] };
    const agentTasks = idx.tasks.filter(function(t) { return t.assignedTo === agentId; });
    var groups = [];
    var reports = [];
    var content = [];
    var totalFiles = 0;
    var contentTypes = { content: true };
    agentTasks.forEach(function(t) {
      var taskDir = path.join(ROOT, 'data/tasks', t.id);
      var taskJson = readJSON(path.join(taskDir, 'task.json'));
      if (!taskJson) return;
      // Only include closed/accepted tasks for categorized view
      var isFinal = taskJson.status === 'closed' || taskJson.status === 'accepted' || taskJson.status === 'done';
      // Find latest version folder
      var latestVn = 0;
      var fileMap = {};
      for (var vn = 1; vn <= 20; vn++) {
        var vDir = path.join(taskDir, 'v' + vn);
        if (!fs.existsSync(vDir)) continue;
        latestVn = vn;
        try {
          var entries = fs.readdirSync(vDir);
          entries.forEach(function(f) {
            if (f === 'version.json') return;
            var fp = path.join(vDir, f);
            try { if (!fs.statSync(fp).isFile()) return; } catch(e) { return; }
            var ext = path.extname(f).toLowerCase();
            var isImage = ['.png','.jpg','.jpeg','.gif','.svg','.webp'].indexOf(ext) >= 0;
            var safeName = encodeURIComponent(f);
            var rawUrl = '/api/tasks/' + t.id + '/versions/' + vn + '/files/' + safeName + '/raw';
            fileMap[f] = { name: f, version: vn, rawUrl: rawUrl, previewUrl: isImage ? rawUrl : '/api/tasks/' + t.id + '/versions/' + vn + '/files/' + safeName, isImage: isImage };
          });
        } catch(e) {}
      }
      var files = Object.values(fileMap);
      if (files.length === 0) return;
      totalFiles += files.length;
      var createdAt = taskJson.updatedAt || taskJson.createdAt || '';
      var group = { taskId: t.id, taskTitle: taskJson.title || 'Untitled Task', taskType: taskJson.type || 'general', taskUpdatedAt: createdAt, createdAt: createdAt, files: files };
      groups.push(group);
      // Categorize for final tasks only
      if (isFinal) {
        // Only include files from the latest version for categorized view
        var latestFiles = files.filter(function(f) { return f.version === latestVn; });
        if (latestFiles.length > 0) {
          var catGroup = { taskId: t.id, taskTitle: taskJson.title || 'Untitled Task', taskType: taskJson.type || 'general', createdAt: createdAt, files: latestFiles };
          if (contentTypes[taskJson.type]) {
            content.push(catGroup);
          } else {
            reports.push(catGroup);
          }
        }
      }
    });
    groups.sort(function(a, b) { return (b.taskUpdatedAt || '').localeCompare(a.taskUpdatedAt || ''); });
    reports.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    content.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    return J(res, { groups: groups, reports: reports, content: content, totalFiles: totalFiles });
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
      assignedTo: b.assignedTo || null, status: b.status || 'planning',
      priority: b.priority || 'medium',
      type: b.type || 'general',
      channel: b.channel || '', version: 1,
      tags: Array.isArray(b.tags) ? b.tags : [],
      brief: b.brief || '',
      autopilot: b.autopilot != null ? !!b.autopilot : ((readJSON(path.join(ROOT, 'config/system.json')) || {}).globalAutopilot === true),
      parentTaskId: b.parentTaskId || null,
      subtasks: Array.isArray(b.subtasks) ? b.subtasks : [],
      dependsOn: Array.isArray(b.dependsOn) ? b.dependsOn : [],
      dueDate: b.dueDate || null,
      blocker: b.blocker || null,
      interval: b.interval || null,
      intervalUnit: b.intervalUnit || null,
      lastRun: b.lastRun || null,
      nextRun: null,
      runCount: b.runCount || 0,
      progressLog: [],
      createdAt: now, updatedAt: now
    };
    // Compute nextRun for recurring autopilot tasks
    if (t.autopilot && t.interval && t.intervalUnit) {
      var ms = t.interval * ({ minutes: 60000, hours: 3600000, days: 86400000 }[t.intervalUnit] || 60000);
      t.nextRun = new Date(Date.now() + ms).toISOString();
    }
    writeJSON(path.join(dir, 'task.json'), t);
    // Write initial v1/version.json
    writeJSON(path.join(dir, 'v1/version.json'), {
      number: 1, content: b.content || '', status: 'submitted',
      decision: null, comments: '', submittedAt: now, decidedAt: null,
      deliverable: b.deliverable || '', result: b.result || ''
    });
    const ip = path.join(ROOT, 'data/tasks/_index.json');
    const ix = readJSON(ip) || { tasks: [] };
    ix.tasks.push({ id: id, title: t.title, status: t.status, assignedTo: t.assignedTo, priority: t.priority, type: t.type, autopilot: t.autopilot, parentTaskId: t.parentTaskId, blocker: t.blocker, interval: t.interval || null, intervalUnit: t.intervalUnit || null });
    writeJSON(ip, ix);
    // If this is a subtask, auto-link to parent
    if (t.parentTaskId) {
      var parentTp = path.join(ROOT, 'data/tasks', t.parentTaskId, 'task.json');
      var parentTask = readJSON(parentTp);
      if (parentTask) {
        if (!parentTask.subtasks) parentTask.subtasks = [];
        if (parentTask.subtasks.indexOf(id) === -1) parentTask.subtasks.push(id);
        parentTask.updatedAt = now;
        writeJSON(parentTp, parentTask);
      }
    }
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

  // TASK SUBTASKS
  const tsm = pn.match(/^\/api\/tasks\/([^\/]+)\/subtasks$/);
  if (tsm && m === 'POST') {
    const parentId = tsm[1];
    const parentTp = path.join(ROOT, 'data/tasks', parentId, 'task.json');
    const parent = readJSON(parentTp);
    if (!parent) return E(res, 'Parent not found', 404);
    // Unlimited nesting allowed - no depth limit
    const b = await parseBody(req);
    const subId = b.id || genId();
    const subDir = path.join(ROOT, 'data/tasks', subId);
    fs.mkdirSync(path.join(subDir, 'v1'), { recursive: true });
    const now = new Date().toISOString();
    const sub = {
      id: subId, title: b.title || 'Untitled', description: b.description || '',
      assignedTo: b.assignedTo || null, status: b.status || 'planning',
      priority: b.priority || parent.priority || 'medium',
      type: b.type || parent.type || 'general',
      channel: b.channel || '', version: 1,
      tags: Array.isArray(b.tags) ? b.tags : [],
      brief: b.brief || '',
      autopilot: b.autopilot != null ? !!b.autopilot : ((readJSON(path.join(ROOT, 'config/system.json')) || {}).globalAutopilot === true),
      parentTaskId: parentId,
      subtasks: [],
      dependsOn: Array.isArray(b.dependsOn) ? b.dependsOn : [],
      dueDate: b.dueDate || null,
      blocker: b.blocker || null,
      progressLog: [],
      createdAt: now, updatedAt: now
    };
    writeJSON(path.join(subDir, 'task.json'), sub);
    writeJSON(path.join(subDir, 'v1/version.json'), {
      number: 1, content: b.content || '', status: 'submitted',
      decision: null, comments: '', submittedAt: now, decidedAt: null,
      deliverable: b.deliverable || '', result: b.result || ''
    });
    // Link to parent
    if (!parent.subtasks) parent.subtasks = [];
    parent.subtasks.push(subId);
    parent.updatedAt = now;
    writeJSON(parentTp, parent);
    // Update index
    const ip = path.join(ROOT, 'data/tasks/_index.json');
    const ix = readJSON(ip) || { tasks: [] };
    ix.tasks.push({ id: subId, title: sub.title, status: sub.status, assignedTo: sub.assignedTo, priority: sub.priority, type: sub.type, autopilot: sub.autopilot, parentTaskId: parentId, blocker: sub.blocker });
    writeJSON(ip, ix);
    broadcast('tasks');
    return J(res, sub, 201);
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
          vd.number = parseInt(e.slice(1));
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

  // SERVE VERSION FILE RAW (binary-safe, for images/downloads)
  const tvfr = pn.match(/^\/api\/tasks\/([^\/]+)\/versions\/(\d+)\/files\/(.+)\/raw$/);
  if (tvfr && m === 'GET') {
    var rawPath = path.join(ROOT, 'data/tasks', tvfr[1], 'v' + tvfr[2], decodeURIComponent(tvfr[3]));
    if (!rawPath.startsWith(path.join(ROOT, 'data/tasks', tvfr[1]))) { res.writeHead(403); return res.end('Forbidden'); }
    if (!fs.existsSync(rawPath)) { res.writeHead(404); return res.end('Not found'); }
    try {
      var rawData = fs.readFileSync(rawPath);
      var rawExt = path.extname(tvfr[3]).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[rawExt] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return res.end(rawData);
    } catch(e) { res.writeHead(500); return res.end('Error'); }
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

    // Handle review actions: done, approve, accept, close, improve, cancel, hold
    if (b.action === 'done' || b.action === 'approve' || b.action === 'accept' || b.action === 'close' || b.action === 'improve' || b.action === 'cancel' || b.action === 'hold') {
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
      } else if (b.action === 'accept') {
        vData.decision = 'accepted';
        writeJSON(vPath, vData);
        actionResult = Object.assign({}, ex, { status: 'accepted', updatedAt: now });
      } else if (b.action === 'close') {
        vData.decision = 'closed';
        writeJSON(vPath, vData);
        actionResult = Object.assign({}, ex, { status: 'closed', updatedAt: now });
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
          number: nextV, content: '', status: 'planning',
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
      if (ai >= 0) aix.tasks[ai] = { id: id, title: actionResult.title, status: actionResult.status, assignedTo: actionResult.assignedTo, priority: actionResult.priority, type: actionResult.type || 'general', autopilot: actionResult.autopilot || false, parentTaskId: actionResult.parentTaskId || null, blocker: actionResult.blocker || null };
      writeJSON(aip, aix);

      // Auto-advance parent task when all subtasks are accepted/closed/done (recursive for deep nesting)
      if ((actionResult.status === 'accepted' || actionResult.status === 'closed' || actionResult.status === 'done') && actionResult.parentTaskId) {
        var checkParentId = actionResult.parentTaskId;
        while (checkParentId) {
          var parentTp2 = path.join(ROOT, 'data/tasks', checkParentId, 'task.json');
          var parentTask2 = readJSON(parentTp2);
          if (!parentTask2 || !parentTask2.subtasks || parentTask2.subtasks.length === 0) break;
          var allDone = parentTask2.subtasks.every(function(sid) {
            var sub = readJSON(path.join(ROOT, 'data/tasks', sid, 'task.json'));
            return sub && (sub.status === 'accepted' || sub.status === 'closed' || sub.status === 'done');
          });
          if (allDone && parentTask2.status !== 'pending_approval' && parentTask2.status !== 'accepted' && parentTask2.status !== 'closed') {
            // Autopilot parent: auto-close instead of pending_approval
            if (parentTask2.autopilot) {
              parentTask2.status = 'closed';
              if (!parentTask2.progressLog) parentTask2.progressLog = [];
              parentTask2.progressLog.push({ message: 'Autopilot: auto-closed (all subtasks done)', agentId: parentTask2.assignedTo || null, timestamp: now });
            } else {
              parentTask2.status = 'pending_approval';
            }
            parentTask2.updatedAt = now;
            writeJSON(parentTp2, parentTask2);
            var pi = aix.tasks.findIndex(function(x) { return x.id === checkParentId; });
            if (pi >= 0) { aix.tasks[pi].status = parentTask2.status; writeJSON(aip, aix); }
            checkParentId = parentTask2.parentTaskId;
          } else {
            break;
          }
        }
      }

      // Auto-start dependent tasks when all dependencies are accepted/closed/done
      if (actionResult.status === 'accepted' || actionResult.status === 'closed' || actionResult.status === 'done') {
        aix.tasks.forEach(function(t) {
          var dep = readJSON(path.join(ROOT, 'data/tasks', t.id, 'task.json'));
          if (dep && dep.dependsOn && dep.dependsOn.length > 0 && dep.status === 'planning') {
            var allMet = dep.dependsOn.every(function(did) {
              var d = readJSON(path.join(ROOT, 'data/tasks', did, 'task.json'));
              return d && (d.status === 'accepted' || d.status === 'closed' || d.status === 'done');
            });
            if (allMet) {
              dep.status = 'in_progress';
              dep.updatedAt = now;
              writeJSON(path.join(ROOT, 'data/tasks', t.id, 'task.json'), dep);
              var di = aix.tasks.findIndex(function(x) { return x.id === t.id; });
              if (di >= 0) { aix.tasks[di].status = 'in_progress'; }
            }
          }
        });
        writeJSON(aip, aix);
      }

      broadcast('tasks');
      return J(res, actionResult);
    }

    // Submission validation: reject pending_approval with empty version content
    if (b.status === 'pending_approval' && ex.status !== 'pending_approval') {
      var taskDir2 = path.join(ROOT, 'data/tasks', id);
      var latestV2 = ex.version || 1;
      try {
        var entries2 = fs.readdirSync(taskDir2);
        entries2.forEach(function(e) { if (/^v\d+$/.test(e)) { var n = parseInt(e.slice(1)); if (n > latestV2) latestV2 = n; } });
      } catch(e) {}
      var vData2 = readJSON(path.join(taskDir2, 'v' + latestV2, 'version.json'));
      if (!vData2 || !vData2.content || !vData2.content.trim()) {
        return E(res, 'Cannot submit: version content is empty. Update version first.', 400);
      }
    }

    // Enforce valid status transitions
    if (b.status && b.status !== ex.status) {
      var allowed = VALID_TRANSITIONS[ex.status];
      if (allowed && allowed.indexOf(b.status) === -1) {
        // Special case: autopilot auto-close (pending_approval -> closed) is allowed
        var isAutopilotClose = b.status === 'closed' && ex.status === 'pending_approval' && (b.autopilot || ex.autopilot);
        if (!isAutopilotClose) {
          return E(res, 'Invalid status transition: ' + ex.status + ' -> ' + b.status, 400);
        }
      }
    }

    // Autopilot auto-close: if task is autopilot and being set to pending_approval, auto-close it
    var autopilotClosed = false;
    if (b.status === 'pending_approval' && ex.status !== 'pending_approval' && (b.autopilot || ex.autopilot)) {
      b.status = 'closed';
      autopilotClosed = true;
    }

    // Default: merge update
    var merged = Object.assign({}, ex, b, { id: id, updatedAt: now });

    // Recompute nextRun if interval fields changed
    if ((b.interval !== undefined || b.intervalUnit !== undefined) && merged.autopilot && merged.interval && merged.intervalUnit) {
      var intMs = merged.interval * ({ minutes: 60000, hours: 3600000, days: 86400000 }[merged.intervalUnit] || 60000);
      merged.nextRun = new Date(Date.now() + intMs).toISOString();
    }

    // Autopilot auto-close: log progress
    if (autopilotClosed) {
      if (!merged.progressLog) merged.progressLog = [];
      merged.progressLog.push({ message: 'Autopilot: auto-closed', agentId: merged.assignedTo || null, timestamp: now });
    }

    // Blocker field handling: auto-log progress when blocker changes
    if (b.blocker !== undefined && b.blocker !== ex.blocker) {
      if (!merged.progressLog) merged.progressLog = [];
      if (b.blocker) {
        merged.progressLog.push({ message: 'BLOCKER: ' + b.blocker, agentId: b.agentId || merged.assignedTo || null, timestamp: now });
      } else {
        merged.progressLog.push({ message: 'BLOCKER RESOLVED', agentId: b.agentId || merged.assignedTo || null, timestamp: now });
      }
    }

    writeJSON(tp, merged);
    var mip = path.join(ROOT, 'data/tasks/_index.json');
    var mix = readJSON(mip) || { tasks: [] };
    var mi = mix.tasks.findIndex(function(x) { return x.id === id; });
    if (mi >= 0) mix.tasks[mi] = { id: id, title: merged.title, status: merged.status, assignedTo: merged.assignedTo, priority: merged.priority, type: merged.type || 'general', autopilot: merged.autopilot || false, parentTaskId: merged.parentTaskId || null, blocker: merged.blocker || null, interval: merged.interval || null, intervalUnit: merged.intervalUnit || null };
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

  // ── SERVER CONTROL ─────────────────────────────────
  if (pn === '/api/server/shutdown' && m === 'POST') {
    J(res, { ok: true, message: 'Server shutting down' });
    // Kill all terminal sessions
    termSessions.forEach(function(s) { try { s.pty.kill(); } catch(e) {} });
    setTimeout(function() { process.exit(0); }, 500);
    return;
  }
  if (pn === '/api/server/restart' && m === 'POST') {
    J(res, { ok: true, message: 'Server restarting' });
    // Kill all terminal sessions
    termSessions.forEach(function(s) { try { s.pty.kill(); } catch(e) {} });
    // Spawn a new server process detached
    var child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      detached: true,
      stdio: 'ignore',
      cwd: ROOT
    });
    child.unref();
    setTimeout(function() { process.exit(0); }, 500);
    return;
  }

  // ── BACKUP / RESTORE ────────────────────────────────
  var backupsDir = path.join(ROOT, 'backups');

  if (pn === '/api/backup/create' && m === 'POST') {
    var b = await parseBody(req);
    var includeMedia = !!(b && b.includeMedia);
    var ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
    var backupId = 'backup-' + ts;
    var dest = path.join(backupsDir, backupId);
    fs.mkdirSync(dest, { recursive: true });
    var folders = ['agents', 'data', 'config', 'profile'];
    if (!includeMedia) {
      // copy data/ but skip data/media/
      for (var fi = 0; fi < folders.length; fi++) {
        var src = path.join(ROOT, folders[fi]);
        if (!fs.existsSync(src)) continue;
        if (folders[fi] === 'data') {
          // copy data/ contents except media/
          fs.mkdirSync(path.join(dest, 'data'), { recursive: true });
          var dataEntries = fs.readdirSync(src, { withFileTypes: true });
          for (var di = 0; di < dataEntries.length; di++) {
            if (dataEntries[di].name === 'media') continue;
            var ds = path.join(src, dataEntries[di].name);
            var dd = path.join(dest, 'data', dataEntries[di].name);
            if (dataEntries[di].isDirectory()) copyDir(ds, dd);
            else fs.copyFileSync(ds, dd);
          }
        } else {
          copyDir(src, path.join(dest, folders[fi]));
        }
      }
    } else {
      for (var fi = 0; fi < folders.length; fi++) {
        var src = path.join(ROOT, folders[fi]);
        if (fs.existsSync(src)) copyDir(src, path.join(dest, folders[fi]));
      }
    }
    var manifest = { timestamp: new Date().toISOString(), version: readJSON(path.join(ROOT, 'config', 'system.json'))?.version || '?', includeMedia: includeMedia, folders: folders };
    writeJSON(path.join(dest, 'manifest.json'), manifest);
    var sizeMB = (dirSize(dest) / 1048576).toFixed(2);
    return J(res, { ok: true, backupId: backupId, timestamp: manifest.timestamp, sizeMB: sizeMB });
  }

  if (pn === '/api/backup/list' && m === 'GET') {
    var list = [];
    try {
      var dirs = fs.readdirSync(backupsDir, { withFileTypes: true });
      for (var i = 0; i < dirs.length; i++) {
        if (!dirs[i].isDirectory()) continue;
        var man = readJSON(path.join(backupsDir, dirs[i].name, 'manifest.json'));
        var sizeMB = (dirSize(path.join(backupsDir, dirs[i].name)) / 1048576).toFixed(2);
        list.push({ id: dirs[i].name, manifest: man, sizeMB: sizeMB });
      }
    } catch(e) {}
    list.sort(function(a,b) { return b.id.localeCompare(a.id); });
    return J(res, { backups: list });
  }

  if (pn === '/api/backup/restore' && m === 'POST') {
    var b = await parseBody(req);
    if (!b || !b.backupId) return E(res, 'backupId required');
    var id = String(b.backupId).replace(/[^a-zA-Z0-9_-]/g, '');
    var src = path.join(backupsDir, id);
    if (!fs.existsSync(src) || !fs.existsSync(path.join(src, 'manifest.json'))) return E(res, 'Backup not found', 404);
    var man = readJSON(path.join(src, 'manifest.json'));
    var folders = man && man.folders ? man.folders : ['agents', 'data', 'config', 'profile'];
    for (var fi = 0; fi < folders.length; fi++) {
      var backupFolder = path.join(src, folders[fi]);
      if (!fs.existsSync(backupFolder)) continue;
      var target = path.join(ROOT, folders[fi]);
      copyDir(backupFolder, target);
    }
    // Rebuild CLAUDE.md and notify clients
    try { rebuildClaudeMd(); } catch(e) {}
    broadcast({ type: 'refresh', scope: 'all' });
    return J(res, { ok: true, message: 'Backup restored: ' + id });
  }

  if (pn === '/api/backup/delete' && m === 'POST') {
    var b = await parseBody(req);
    if (!b || !b.backupId) return E(res, 'backupId required');
    var id = String(b.backupId).replace(/[^a-zA-Z0-9_-]/g, '');
    var target = path.join(backupsDir, id);
    if (!fs.existsSync(target)) return E(res, 'Backup not found', 404);
    // Recursive delete
    function rmDirRecursive(dir) {
      try {
        var entries = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          var fp = path.join(dir, entries[i].name);
          if (entries[i].isDirectory()) { rmDirRecursive(fp); try { fs.rmdirSync(fp); } catch(e) {} }
          else { try { fs.unlinkSync(fp); } catch(e) {} }
        }
        fs.rmdirSync(dir);
      } catch(e) {}
    }
    rmDirRecursive(target);
    return J(res, { ok: true, message: 'Backup deleted' });
  }

  // UPLOAD IMAGE (clipboard paste)
  if (pn === '/api/upload-image' && m === 'POST') {
    var b = await parseBody(req);
    if (!b.data) return E(res, 'data (base64) required');
    var dest = b.destination || 'clipboard';
    var ts = Date.now();
    var relPath;
    if (dest === 'task' && b.taskId) {
      relPath = 'data/tasks/' + b.taskId + '/images/img-' + ts + '.png';
    } else {
      relPath = 'temp/clipboard/clip-' + ts + '.png';
    }
    var absPath = safePath(relPath);
    if (!absPath) return E(res, 'Invalid path', 403);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    var buf = Buffer.from(b.data, 'base64');
    fs.writeFileSync(absPath, buf);
    broadcast('all');
    return J(res, { ok: true, path: relPath, absPath: absPath });
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

  // LOCAL ACCESS PATHS
  if (pn === '/api/settings/access-paths' && m === 'GET') {
    var sys = readJSON(path.join(ROOT, 'config/system.json')) || {};
    var paths = sys.localAccess || [ROOT.replace(/\\/g, '/')];
    return J(res, { paths: paths, root: ROOT.replace(/\\/g, '/') });
  }
  if (pn === '/api/settings/access-paths' && m === 'POST') {
    var b = await parseBody(req);
    var p = (b.path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!p) return E(res, 'Path is required');
    var sp = path.join(ROOT, 'config/system.json');
    var sys = readJSON(sp) || {};
    var rootNorm = ROOT.replace(/\\/g, '/');
    if (!sys.localAccess) sys.localAccess = [rootNorm];
    if (!sys.localAccess.includes(p)) sys.localAccess.push(p);
    writeJSON(sp, sys);
    rebuildClaudeMd();
    broadcast('settings');
    return J(res, { ok: true, paths: sys.localAccess });
  }
  if (pn === '/api/settings/access-paths' && m === 'DELETE') {
    var b = await parseBody(req);
    var p = (b.path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    var rootNorm = ROOT.replace(/\\/g, '/');
    if (!p || p === rootNorm) return E(res, 'Cannot remove the project folder');
    var sp = path.join(ROOT, 'config/system.json');
    var sys = readJSON(sp) || {};
    if (!sys.localAccess) sys.localAccess = [rootNorm];
    sys.localAccess = sys.localAccess.filter(function(x) { return x !== p; });
    writeJSON(sp, sys);
    rebuildClaudeMd();
    broadcast('settings');
    return J(res, { ok: true, paths: sys.localAccess });
  }

  // SECRETS
  if (pn === '/api/secrets/status' && m === 'GET') {
    var exists = fs.existsSync(getSecretsFilePath());
    return J(res, { locked: secretsCache === null, count: secretsCache ? getSecretNames().length : 0, exists: exists });
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
      syncSecretsToTerminals();
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
  if (pn === '/api/secrets/init' && m === 'POST') {
    var b = await parseBody(req);
    if (!b.password) return E(res, 'Password required');
    if (b.password.length < 4) return E(res, 'Password must be at least 4 characters');
    if (secretsCache) return E(res, 'Vault already exists');
    secretsSalt = crypto.randomBytes(32);
    masterKeyCache = deriveKey(b.password, secretsSalt);
    secretsCache = {};
    saveSecretsFile();
    rebuildClaudeMd();
    syncSecretsToTerminals();
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
    var list = getSecretNames().map(function(name) { return { name: name, maskedValue: maskValue(secretsCache[name]) }; });
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
    syncSecretsToTerminals();
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
    syncSecretsToTerminals();
    broadcast('secrets');
    return J(res, { ok: true });
  }
  if (sm && m === 'DELETE' && !['status','unlock','lock','change-password'].includes(sm[1])) {
    if (!secretsCache) return E(res, 'Secrets are locked', 403);
    var name = sm[1];
    delete secretsCache[name];
    saveSecretsFile();
    if (getSecretNames().length === 0 && getCredentials().length === 0) {
      try { fs.unlinkSync(getSecretsFilePath()); } catch(e) {}
      secretsCache = null; masterKeyCache = null; secretsSalt = null;
    }
    rebuildClaudeMd();
    syncSecretsToTerminals();
    broadcast('secrets');
    return J(res, { ok: true });
  }

  // CREDENTIALS
  if (pn === '/api/credentials' && m === 'GET') {
    if (!secretsCache) return E(res, 'Vault is locked', 403);
    var creds = getCredentials();
    var list = creds.map(function(c) { return { service: c.service, username: c.username, maskedPassword: maskValue(c.password) }; });
    return J(res, { credentials: list });
  }
  if (pn === '/api/credentials' && m === 'POST') {
    var b = await parseBody(req);
    if (!b.service || !b.username || !b.password) return E(res, 'service, username, and password required');
    // Auto-create vault if needed
    if (!secretsCache) {
      if (!b.masterPassword) return E(res, 'Vault is locked. Provide masterPassword to create vault.', 403);
      secretsSalt = crypto.randomBytes(32);
      masterKeyCache = deriveKey(b.masterPassword, secretsSalt);
      secretsCache = {};
    }
    var creds = getCredentials();
    for (var ci = 0; ci < creds.length; ci++) {
      if (creds[ci].service.toLowerCase() === b.service.trim().toLowerCase()) return E(res, 'Credential for this service already exists');
    }
    creds.push({ service: b.service.trim(), username: b.username, password: b.password });
    secretsCache._credentials = creds;
    saveSecretsFile();
    rebuildClaudeMd();
    syncSecretsToTerminals();
    broadcast('secrets');
    return J(res, { ok: true });
  }
  var cm = pn.match(/^\/api\/credentials\/(.+)$/);
  if (cm && m === 'PUT') {
    if (!secretsCache) return E(res, 'Vault is locked', 403);
    var serviceName = decodeURIComponent(cm[1]);
    var b = await parseBody(req);
    var creds = getCredentials();
    var found = false;
    for (var ci = 0; ci < creds.length; ci++) {
      if (creds[ci].service.toLowerCase() === serviceName.toLowerCase()) {
        if (b.username !== undefined) creds[ci].username = b.username;
        if (b.password !== undefined) creds[ci].password = b.password;
        found = true;
        break;
      }
    }
    if (!found) return E(res, 'Credential not found', 404);
    secretsCache._credentials = creds;
    saveSecretsFile();
    rebuildClaudeMd();
    syncSecretsToTerminals();
    broadcast('secrets');
    return J(res, { ok: true });
  }
  if (cm && m === 'DELETE') {
    if (!secretsCache) return E(res, 'Vault is locked', 403);
    var serviceName = decodeURIComponent(cm[1]);
    var creds = getCredentials();
    var newCreds = creds.filter(function(c) { return c.service.toLowerCase() !== serviceName.toLowerCase(); });
    if (newCreds.length === creds.length) return E(res, 'Credential not found', 404);
    secretsCache._credentials = newCreds;
    if (newCreds.length === 0) delete secretsCache._credentials;
    saveSecretsFile();
    if (getSecretNames().length === 0 && getCredentials().length === 0) {
      try { fs.unlinkSync(getSecretsFilePath()); } catch(e) {}
      secretsCache = null; masterKeyCache = null; secretsSalt = null;
    }
    rebuildClaudeMd();
    syncSecretsToTerminals();
    broadcast('secrets');
    return J(res, { ok: true });
  }

  // AUTOPILOT API - removed: schedules are now tasks with autopilot + interval fields

  // UPDATES (delegated to lib/upgrade.js)
  if (pn === '/api/updates/check' && m === 'GET') {
    var result = await upgrade.checkForUpdates(sharedCtx);
    return J(res, result);
  }
  if (pn === '/api/updates/status' && m === 'GET') {
    return J(res, upgrade.getUpdateStatus(sharedCtx));
  }
  if (pn === '/api/updates/upgrade' && m === 'POST') {
    var body = await parseBody(req);
    var result = await upgrade.performUpgrade(sharedCtx, { force: body && body.force });
    broadcast('all');
    return J(res, result, result.success ? 200 : (result.requiresForce ? 409 : 400));
  }
  if (pn === '/api/updates/rollback' && m === 'POST') {
    var body = await parseBody(req);
    var result = upgrade.rollback(sharedCtx, body && body.version);
    broadcast('all');
    return J(res, result, result.success ? 200 : 400);
  }

  // SKILLS (delegated to lib/skills.js)
  if (pn === '/api/skills' && m === 'GET') {
    return J(res, skills.handleGetSkills(sharedCtx));
  }

  // SKILL SEARCH (MCP Registry / npm proxy)
  if (pn === '/api/skills/search' && m === 'GET') {
    var searchParams = new URL(req.url, 'http://localhost').searchParams;
    var searchResult = await skills.handleSkillSearch(sharedCtx,
      searchParams.get('q') || '',
      searchParams.get('source') || 'registry',
      searchParams.get('cursor') || '');
    return J(res, searchResult);
  }

  // USER SKILL INSTALL
  if (pn === '/api/skills/user/install' && m === 'POST') {
    var b = await parseBody(req);
    var installResult = await skills.handleUserSkillInstall(sharedCtx, b);
    if (installResult.error) return E(res, installResult.error, installResult.status || 400);
    return J(res, installResult);
  }

  // USER SKILL UNINSTALL
  var userSkillMatch = pn.match(/^\/api\/skills\/user\/([^\/]+)$/);
  if (userSkillMatch && m === 'DELETE') {
    var uninstallResult = skills.handleUserSkillUninstall(sharedCtx, userSkillMatch[1]);
    if (uninstallResult.error) return E(res, uninstallResult.error, uninstallResult.status || 400);
    return J(res, uninstallResult);
  }

  var skillSettingsMatch = pn.match(/^\/api\/skills\/([^\/]+)\/settings$/);
  if (skillSettingsMatch && m === 'PUT') {
    var b = await parseBody(req);
    return J(res, skills.handleSkillSettings(sharedCtx, skillSettingsMatch[1], b));
  }

  var skillMatch = pn.match(/^\/api\/skills\/([^\/]+)\/(enable|disable)$/);
  if (skillMatch && m === 'POST') {
    var result = await skills.handleSkillToggle(sharedCtx, skillMatch[1], skillMatch[2]);
    if (result.error) return E(res, result.error, result.status || 400);
    return J(res, result, result.status || 200);
  }

  // GITHUB STATUS
  if (pn === '/api/skills/github/status' && m === 'GET') {
    var ghResult = await skills.getGitHubStatus(sharedCtx);
    return J(res, ghResult);
  }

  // SCREEN RECORDER CONTROL
  var recMatch = pn.match(/^\/api\/skills\/screen-recorder\/(start|stop|status)$/);
  if (recMatch) {
    var recBody = (recMatch[1] === 'start' && m === 'POST') ? await parseBody(req) : null;
    var recResult = await skills.handleScreenRecorder(sharedCtx, recMatch[1], recBody);
    if (recResult.error && recResult.status) return E(res, recResult.error, recResult.status);
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

  // HEALTH (delegated to lib/health.js)
  if (pn === '/api/health' && m === 'GET') {
    return J(res, health.validateSystem(sharedCtx));
  }

  // Clear upgrade-pending flag
  if (pn === '/api/health/clear-upgrade' && m === 'POST') {
    var flagPath = path.join(ROOT, 'config/.upgrade-pending');
    try {
      if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
      return J(res, { ok: true, message: 'Upgrade flag cleared.' });
    } catch (e) {
      return J(res, { ok: false, message: 'Failed to clear flag: ' + e.message }, 500);
    }
  }

  // SYSTEM NOTICES (delegated to lib/health.js)
  if (pn === '/api/system-notices' && m === 'GET') {
    return J(res, health.listNotices(sharedCtx));
  }
  var noticeMatch = pn.match(/^\/api\/system-notices\/([^\/]+)\/dismiss$/);
  if (noticeMatch && m === 'POST') {
    return J(res, health.dismissNotice(sharedCtx, decodeURIComponent(noticeMatch[1])));
  }

  // MEDIA FILE SERVING (supports subdirectories like social-images/)
  if (pn.startsWith('/api/media/files/') && m === 'GET') {
    const filename = decodeURIComponent(pn.slice('/api/media/files/'.length));
    if (filename.indexOf('..') >= 0 || filename.indexOf('\\') >= 0) {
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
    if (filename.indexOf('..') >= 0 || filename.indexOf('\\') >= 0) {
      return E(res, 'Invalid filename', 403);
    }
    const filePath = path.join(ROOT, 'data', 'media', filename);
    if (!filePath.startsWith(path.join(ROOT, 'data', 'media'))) return E(res, 'Forbidden', 403);
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

  // RAW BINARY FILE SERVING (for inline images, etc.)
  if (pn.startsWith('/api/raw/') && m === 'GET') {
    const rawRel = decodeURIComponent(pn.slice('/api/raw/'.length));
    // Only allow data/ and temp/ directories
    if (!rawRel.startsWith('data/') && !rawRel.startsWith('temp/')) {
      res.writeHead(403); return res.end('Forbidden: only data/ and temp/ allowed');
    }
    const rawResolved = safePath(rawRel);
    if (!rawResolved) { res.writeHead(403); return res.end('Forbidden'); }
    try {
      const rawData = fs.readFileSync(rawResolved);
      const rawExt = path.extname(rawResolved).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[rawExt] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      return res.end(rawData);
    } catch(e) { res.writeHead(404); return res.end('Not found'); }
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
    // ── Terminal WebSocket (delegated to lib/pty.js) ──
    if (!doWsHandshake(req, socket)) return;
    ptyMod.handleTerminalWs(socket, urlObj, sharedCtx);
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

// ── Auto-Close Done Tasks ────────────────────────────────
function autoCloseDoneTasks() {
  var indexPath = path.join(ROOT, 'data/tasks/_index.json');
  var index = readJSON(indexPath);
  if (!index || !index.tasks) return;
  var now = Date.now();
  var twoDays = 2 * 24 * 60 * 60 * 1000;
  var changed = false;
  index.tasks.forEach(function(t) {
    if (t.status !== 'done') return;
    var taskPath = path.join(ROOT, 'data/tasks', t.id, 'task.json');
    var task = readJSON(taskPath);
    if (!task || task.status !== 'done') return;
    var updatedAt = new Date(task.updatedAt || task.createdAt).getTime();
    if (now - updatedAt >= twoDays) {
      task.status = 'closed';
      task.updatedAt = new Date().toISOString();
      if (!task.progressLog) task.progressLog = [];
      task.progressLog.push({ message: 'Auto-closed: done for 2+ days', agentId: null, timestamp: task.updatedAt });
      writeJSON(taskPath, task);
      t.status = 'closed';
      changed = true;
    }
  });
  if (changed) { writeJSON(indexPath, index); broadcast('tasks'); }
}

// Run auto-close on startup
autoCloseDoneTasks();

// Run auto-close every hour
setInterval(autoCloseDoneTasks, 60 * 60 * 1000);

// ── Autopilot Scheduler Engine ───────────────────────────
function computeNextRun(from, interval, unit) {
  var ms = interval * ({ minutes: 60000, hours: 3600000, days: 86400000 }[unit] || 60000);
  return new Date(from.getTime() + ms).toISOString();
}

setInterval(function() {
  var index = readJSON(path.join(ROOT, 'data/tasks/_index.json'));
  if (!index || !index.tasks) return;
  var now = new Date();
  var changed = false;

  index.tasks.forEach(function(entry) {
    // Only process recurring autopilot tasks
    if (!entry.autopilot || !entry.interval || !entry.intervalUnit) return;
    if (entry.status === 'cancelled') return;

    // Read full task
    var taskPath = path.join(ROOT, 'data/tasks', entry.id, 'task.json');
    var task = readJSON(taskPath);
    if (!task) return;

    // Skip if not due yet
    if (!task.nextRun || new Date(task.nextRun) > now) return;

    // Skip if still running (overlap protection) or on hold
    if (task.status === 'in_progress' || task.status === 'hold' || task.status === 'planning' || task.status === 'pending_approval') return;

    // Reset task to in_progress for next run
    task.status = 'in_progress';
    task.lastRun = now.toISOString();
    task.nextRun = computeNextRun(now, task.interval, task.intervalUnit);
    task.updatedAt = now.toISOString();
    task.runCount = (task.runCount || 0) + 1;
    if (!task.progressLog) task.progressLog = [];
    task.progressLog.push({
      message: 'Recurring autopilot triggered (run #' + task.runCount + ')',
      agentId: 'system',
      timestamp: now.toISOString()
    });
    writeJSON(taskPath, task);

    // Update index entry
    entry.status = 'in_progress';
    changed = true;

    // Send prompt to terminal PTY
    var sentTo = null;
    termSessions.forEach(function(session, sid) {
      if (sentTo) return;
      if (session.pty) {
        var prompt = task.description || task.title;
        // Append task ID so orchestrator can track it
        prompt = prompt + ' [Task ID: ' + task.id + ']';
        if (task.assignedTo && task.assignedTo !== 'orchestrator') {
          var reg = readJSON(path.join(ROOT, 'agents/_registry.json')) || { agents: [] };
          var agent = reg.agents.find(function(a) { return a.id === task.assignedTo; });
          var agentName = agent ? agent.name : task.assignedTo;
          prompt = 'Work as agent ' + agentName + ' (ID: ' + task.assignedTo + '): ' + prompt;
        }
        session.pty.write(prompt + '\r');
        sentTo = sid;
      }
    });

    // If no terminal found, set blocker
    if (!sentTo) {
      task.blocker = 'No active terminal session found - cannot send autopilot prompt';
      task.status = 'in_progress';
      if (!task.progressLog) task.progressLog = [];
      task.progressLog.push({
        message: 'BLOCKER: No active terminal session found',
        agentId: 'system',
        timestamp: now.toISOString()
      });
      writeJSON(taskPath, task);
      entry.blocker = task.blocker;
    }
  });

  if (changed) {
    writeJSON(path.join(ROOT, 'data/tasks/_index.json'), index);
    broadcast('tasks');
  }
}, 60000);

// ── Startup ──────────────────────────────────────────────
fs.mkdirSync(path.join(ROOT, 'data/knowledge'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'temp'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });

// Ensure default team-rules (Agent Operating System) on fresh install
(function ensureDefaultTeamRules() {
  var rulesPath = path.join(ROOT, 'config/team-rules.md');
  if (fs.existsSync(rulesPath)) return;
  var defaultRules = '# Team Rules\n\n' +
    '## #1 Rule: Mission-Driven Execution\n' +
    '- The team exists to EXECUTE and DELIVER results. Not plans. Not briefs. Not checklists. Results.\n' +
    '- Agents must DO the work, not describe how to do it\n' +
    '- Only flag genuine blockers (missing credentials, need owner\'s personal account login)\n' +
    '- Never set pending_approval for work that was already approved upstream - just finish it\n\n' +
    '## Delegation & Task Tracking\n' +
    '- The orchestrator MUST delegate work to agents via tasks - never do the actual work itself\n' +
    '- All work must be tracked as tasks in the dashboard so the owner has full visibility\n' +
    '- Create tasks via `POST /api/tasks` with the appropriate agent assigned\n\n' +
    '## Task Lifecycle (CORRECTED FLOW)\n\n' +
    '### Flow: Prepare -> Review -> Execute -> Verify -> Close\n\n' +
    '1. **Planning** (planning): Agent creates plan/materials\n' +
    '2. **Submit for review** (pending_approval): Agent fills version.json + sets pending_approval\n' +
    '3. **Owner reviews**: Accept (go execute) or Improve (revise)\n' +
    '4. **Execute** (in_progress): Agent executes the approved work (posts content, deploys code, etc.)\n' +
    '5. **Submit proof** (pending_approval): Agent updates version with execution proof + sets pending_approval\n' +
    '6. **Owner verifies**: Checks proof (URL works, code deployed, etc.) and closes\n\n' +
    '### Status Meanings\n' +
    '- **Planning** (`planning`): Agent creating plan/materials before first review\n' +
    '- **Working** (`in_progress`): Agent executing after acceptance\n' +
    '- **Pending** (`pending_approval`): Either materials ready for review OR execution proof ready for verify\n' +
    '- **Accepted** (`accepted`): Owner approved materials - triggers agent execution immediately\n' +
    '- **Improve** (`revision_needed`): Owner sent feedback - agent revises, resubmits to pending\n' +
    '- **Closed** (`closed`): Owner verified execution proof. Terminal state.\n' +
    '- **Hold** (`hold`): Paused - do not work on until the owner releases it.\n' +
    '- **Cancelled** (`cancelled`): Abandoned - no further action.\n\n' +
    '## Agent Execution Checklist\n\n' +
    '### Phase 1: Prepare\n' +
    '1. Set status to `in_progress`\n' +
    '2. Log progress: "Starting: {what I\'m preparing}"\n' +
    '3. Create materials (plan, code, research, etc.)\n' +
    '4. Save materials to `data/tasks/{id}/v{n}/`\n' +
    '5. Update version.json: `content` (REQUIRED), `deliverable` (file paths)\n' +
    '6. Set status to `pending_approval`\n' +
    '7. STOP and wait for owner review\n\n' +
    '### Phase 2: Execute (after owner accepts)\n' +
    '8. Set status to `in_progress`\n' +
    '9. Log progress: "Executing: {what I\'m doing}"\n' +
    '10. Execute the approved work\n' +
    '11. If blocker: `PUT /api/tasks/{id} {"blocker": "reason"}` and STOP\n' +
    '12. Update version.json: `content` (execution summary), `result` (proof - URLs, screenshots)\n' +
    '13. Set status to `pending_approval`\n\n' +
    '### Blocker Protocol\n' +
    '- Hit a blocker? Set blocker field immediately: `PUT /api/tasks/{id} {"blocker": "reason"}`\n' +
    '- Blocker persists with red glow until explicitly cleared\n' +
    '- Do NOT keep working past a blocker - set it and stop\n' +
    '- When unblocked: orchestrator clears field and relaunches agent\n\n' +
    '### Required proof by task type\n' +
    '- **Content/Social**: `result` = published URL (mandatory)\n' +
    '- **Development**: `result` = file paths changed, test results, or PR URL\n' +
    '- **Research**: `deliverable` = report file path in version folder\n' +
    '- **Operations**: `result` = verification or outcome description\n\n' +
    '## Deliverable Tracking (MANDATORY)\n\n' +
    'Every completed task MUST have visible outcomes in the task detail page.\n' +
    '- Server rejects pending_approval with empty version content\n' +
    '- Never close a content task without the published URL\n' +
    '- Save all deliverable files to `data/tasks/{taskId}/v{n}/`\n\n' +
    '## Round Table Protocol\n\n' +
    'Round tables are **execution-first**. The orchestrator acts before it reports.\n\n' +
    '### Phase 1: Execute (do this BEFORE reporting)\n' +
    '1. **Launch agents on accepted tasks** - owner approved materials, agent must EXECUTE (not auto-close)\n' +
    '2. **Launch agents on revision_needed tasks** - owner already gave feedback, agent must act\n' +
    '3. **Launch agents on planning tasks** that are ready (assigned, dependencies met)\n' +
    '4. **Clear blockers** - read blocker field on tasks, report the text directly\n\n' +
    '### Phase 2: Surface blockers\n' +
    '- Tasks with `blocker` field set - report the blocker text directly\n' +
    '- Tasks in_progress with no recent progress - may be stalled\n' +
    '- Tasks that need owner input (pending_approval)\n\n' +
    '### Phase 3: Report\n' +
    '- Brief status summary\n' +
    '- What was just executed\n' +
    '- What needs the owner\'s decision\n';
  writeText(rulesPath, defaultRules);
  console.log('  Default team rules (Agent Operating System) created.');
})();

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

// ── Migrations (from lib/migrations.js) ──────────────────
var migrationResult = migrations.runPendingMigrations(sharedCtx);
if (migrationResult.ran > 0) {
  try { rebuildClaudeMd(); } catch(e) {}
}

// ── Interrupted upgrade check ────────────────────────────
var interruptedUpgrade = upgrade.checkInterruptedUpgrade(sharedCtx);
if (interruptedUpgrade) {
  console.log('\n  WARNING: Interrupted upgrade detected!');
  console.log('  Current version: ' + interruptedUpgrade.currentVersion);
  if (interruptedUpgrade.migrationFailed) {
    console.log('  Migration failed: ' + interruptedUpgrade.migrationFailed.migration + ' - ' + interruptedUpgrade.migrationFailed.error);
  }
  if (interruptedUpgrade.availableBackups.length > 0) {
    console.log('  Available backups: ' + interruptedUpgrade.availableBackups.join(', '));
    console.log('  Use POST /api/updates/rollback to restore.');
  }
  console.log('');
}

// ── Health Validation (from lib/health.js) ───────────────
var healthResult = health.validateSystem(sharedCtx);
if (healthResult.issues.length > 0) {
  console.log('  System health: ' + healthResult.status.toUpperCase());
  for (var hi = 0; hi < healthResult.issues.length; hi++) {
    var issue = healthResult.issues[hi];
    var prefix = issue.level === 'error' ? '  ERROR' : issue.level === 'warning' ? '  WARN ' : '  INFO ';
    console.log(prefix + ' [' + issue.check + '] ' + issue.message);
  }
  console.log('');
} else {
  console.log('  System health: OK');
}

(async function() {
  var envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
  var configPort = getConfiguredPort();
  var requestedPort = envPort || configPort || 3796;

  // Check if port is available - fail loudly if busy (never auto-switch)
  if (!(await isPortFree(requestedPort))) {
    console.error('\n  ERROR: Port ' + requestedPort + ' is already in use.');
    console.error('  TeamHero requires this port. Please free it and try again.');
    console.error('  To find what is using it: lsof -i :' + requestedPort + ' (macOS/Linux) or netstat -ano | findstr ' + requestedPort + ' (Windows)\n');
    process.exit(1);
  }

  PORT = requestedPort;
  server.listen(PORT, function() { console.log('\n  Agent Team Portal running at http://localhost:' + PORT + '\n'); });
})();
