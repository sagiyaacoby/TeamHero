// ── Skills Management ────────────────────────────────────
// Extracted from server.js - zero behavior change
// Extended with MCP Registry search, user skill catalog, and install/uninstall

const { execSync, spawn } = require('child_process');
const https = require('https');

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
  'git': { winget: 'Git.Git', choco: 'git', brew: 'git', apt: 'git', yum: 'git', pacman: 'git' },
  'gh': { winget: 'GitHub.cli', choco: 'gh', brew: 'gh', apt: 'gh', yum: 'gh', pacman: 'github-cli' }
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

// ── Catalog helpers ──────────────────────────────────────

/**
 * Load both system and user catalogs merged together
 */
function loadAllCatalogs(ctx) {
  var systemCatalog = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/skills-catalog.json')) || [];
  var userCatalog = ctx.readJSON(ctx.path.join(ctx.ROOT, 'data/skills/user-catalog.json')) || [];
  // Tag system skills
  systemCatalog = systemCatalog.map(function(s) {
    return Object.assign({}, s, { source: s.source || 'system' });
  });
  // User skills already have source set
  return systemCatalog.concat(userCatalog);
}

/**
 * Find a skill by ID across both catalogs
 */
function findSkillById(ctx, skillId) {
  var all = loadAllCatalogs(ctx);
  return all.find(function(s) { return s.id === skillId; }) || null;
}

/**
 * Load user catalog
 */
function loadUserCatalog(ctx) {
  return ctx.readJSON(ctx.path.join(ctx.ROOT, 'data/skills/user-catalog.json')) || [];
}

/**
 * Save user catalog
 */
function saveUserCatalog(ctx, catalog) {
  ctx.writeJSON(ctx.path.join(ctx.ROOT, 'data/skills/user-catalog.json'), catalog);
}

/**
 * Handle GET /api/skills
 * @param {object} ctx - { ROOT, readJSON, path, fs }
 */
function handleGetSkills(ctx) {
  var catalog = loadAllCatalogs(ctx);
  var enabled = ctx.readJSON(ctx.path.join(ctx.ROOT, 'data/skills/enabled.json')) || {};
  var skills = catalog.map(function(s) {
    var deps = (s.systemDeps || []).map(function(dep) {
      return { name: dep, installed: commandExists(dep) };
    });
    var missingDeps = deps.filter(function(d) { return !d.installed; }).map(function(d) { return d.name; });
    var settingValues = {};
    if (s.settings && s.settings.length) {
      var sv = ctx.readJSON(ctx.path.join(ctx.ROOT, 'data/skills', s.id + '-settings.json'));
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
  return { skills: skills };
}

/**
 * Handle PUT /api/skills/:id/settings
 * @param {object} ctx - { ROOT, readJSON, writeJSON, path, fs, broadcast }
 * @param {string} skillId
 * @param {object} body - settings key/value pairs
 */
function handleSkillSettings(ctx, skillId, body) {
  var settingsPath = ctx.path.join(ctx.ROOT, 'data/skills', skillId + '-settings.json');
  var existing = ctx.readJSON(settingsPath) || {};
  // Merge - don't overwrite with masked values
  for (var key in body) {
    if (body[key] && body[key] !== '********') existing[key] = body[key];
  }
  ctx.writeJSON(settingsPath, existing);

  // Update .mcp.json env vars with actual values - search both catalogs
  var skill = findSkillById(ctx, skillId);
  if (skill && skill.type === 'mcp' && skill.mcpConfig && skill.mcpConfig.env) {
    var mcpPath = ctx.path.join(ctx.ROOT, '.mcp.json');
    var mcpData = ctx.readJSON(mcpPath) || { mcpServers: {} };
    if (mcpData.mcpServers[skillId]) {
      var env = {};
      for (var envKey in skill.mcpConfig.env) {
        var tmpl = skill.mcpConfig.env[envKey];
        var match = tmpl.match(/^\$\{(.+)\}$/);
        env[envKey] = match && existing[match[1]] ? existing[match[1]] : tmpl;
      }
      mcpData.mcpServers[skillId].env = env;
      ctx.writeJSON(mcpPath, mcpData);
    }
  }

  ctx.broadcast('skills');
  return { ok: true };
}

/**
 * Handle POST /api/skills/:id/enable or /disable
 * @param {object} ctx - { ROOT, readJSON, writeJSON, path, fs, broadcast }
 * @param {string} skillId
 * @param {string} action - 'enable' or 'disable'
 */
async function handleSkillToggle(ctx, skillId, action) {
  // Search both system and user catalogs
  var skill = findSkillById(ctx, skillId);
  if (!skill) return { error: 'Skill not found', status: 404 };

  var enabledPath = ctx.path.join(ctx.ROOT, 'data/skills/enabled.json');
  var enabled = ctx.readJSON(enabledPath) || {};

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
      return {
        ok: false,
        error: 'Missing system dependencies: ' + missingNames,
        details: details,
        depResults: depResults,
        status: 500
      };
    }

    // Step 2: Ensure npm is available
    if (!commandExists('npm')) {
      return { ok: false, error: 'npm is not installed. Please install Node.js from https://nodejs.org', status: 500 };
    }

    // Step 3: Install npm packages (for npm-based skills)
    if (skill.packages && skill.packages.length > 0) {
      var installResult = await new Promise(function(resolve) {
        var args = ['install', '--save'].concat(skill.packages);
        var proc = spawn('npm', args, { cwd: ctx.ROOT, shell: true, timeout: 120000 });
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
        return { ok: false, error: 'npm install failed.' + hint, output: npmOutput, status: 500 };
      }
    }

    // Step 3b: Git-based skills - clone repo and build
    if (skill.gitRepo) {
      var skillDir = ctx.path.join(ctx.ROOT, 'data/skills', skill.id);
      ctx.fs.mkdirSync(skillDir, { recursive: true });

      // Clone if not already cloned
      if (!ctx.fs.existsSync(ctx.path.join(skillDir, '.git'))) {
        var cloneResult = await new Promise(function(resolve) {
          var proc = spawn('git', ['clone', skill.gitRepo, '.'], { cwd: skillDir, shell: true, timeout: 120000 });
          var output = '';
          proc.stdout.on('data', function(ch) { output += ch; });
          proc.stderr.on('data', function(ch) { output += ch; });
          proc.on('close', function(code) { resolve({ success: code === 0, output: output }); });
          proc.on('error', function(err) { resolve({ success: false, output: err.message }); });
        });
        if (!cloneResult.success) {
          return { ok: false, error: 'Git clone failed.', details: cloneResult.output, status: 500 };
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
          return { ok: false, error: 'Build failed.', details: buildResult.output, status: 500 };
        }
      }
    }

    // For MCP skills: write to .mcp.json
    if (skill.type === 'mcp' && skill.mcpConfig) {
      var mcpPath = ctx.path.join(ctx.ROOT, '.mcp.json');
      var mcpData = ctx.readJSON(mcpPath) || { mcpServers: {} };
      // Resolve env vars from secrets for git-based skills
      var mcpEntry = JSON.parse(JSON.stringify(skill.mcpConfig));
      if (skill.gitRepo && mcpEntry.args) {
        mcpEntry.args = mcpEntry.args.map(function(a) {
          return a.replace(/^data\/skills\//, ctx.path.join(ctx.ROOT, 'data/skills/').replace(/\\/g, '/') + '/').replace(/\\/g, '/');
        });
      }
      mcpData.mcpServers[skill.id] = mcpEntry;
      ctx.writeJSON(mcpPath, mcpData);
    }

    // For CLI skills: ensure data/skills/<id>/ directory
    if (skill.type === 'cli') {
      ctx.fs.mkdirSync(ctx.path.join(ctx.ROOT, 'data/skills', skill.id), { recursive: true });
    }

    enabled[skillId] = true;
    ctx.writeJSON(enabledPath, enabled);
    ctx.broadcast('skills');
    return { ok: true, installed: true };

  } else {
    // Disable
    // For MCP skills: remove from .mcp.json
    if (skill.type === 'mcp') {
      var mcpPath = ctx.path.join(ctx.ROOT, '.mcp.json');
      var mcpData = ctx.readJSON(mcpPath) || { mcpServers: {} };
      delete mcpData.mcpServers[skill.id];
      ctx.writeJSON(mcpPath, mcpData);
    }

    enabled[skillId] = false;
    ctx.writeJSON(enabledPath, enabled);
    ctx.broadcast('skills');
    return { ok: true };
  }
}

// ── MCP Registry Search ──────────────────────────────────

/**
 * HTTPS GET helper with timeout
 */
function httpsGetJSON(url, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'TeamHero/1.0', 'Accept': 'application/json' },
      timeout: timeoutMs || 10000
    };
    var req = https.get(opts, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetJSON(res.headers.location, timeoutMs).then(resolve, reject);
      }
      var data = [];
      res.on('data', function(ch) { data.push(ch); });
      res.on('end', function() {
        var body = Buffer.concat(data).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
        try {
          resolve(JSON.parse(body));
        } catch(e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/**
 * Normalize a registry server entry into our format
 */
function normalizeRegistryEntry(server) {
  var npmPkg = null;
  var transport = 'stdio';

  // Extract npm package from packages array
  if (server.packages && server.packages.length) {
    var npmEntry = server.packages.find(function(p) { return p.registryType === 'npm'; });
    if (npmEntry) npmPkg = npmEntry.identifier || npmEntry.name;
  }

  // Extract transport from remotes
  if (server.remotes && server.remotes.length) {
    transport = server.remotes[0].type || 'stdio';
  }

  return {
    id: (server.name || '').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase(),
    registryName: server.name || '',
    name: server.title || server.name || '',
    description: server.description || '',
    version: server.version || '',
    source: 'registry',
    repoUrl: (server.repository && server.repository.url) || '',
    websiteUrl: server.websiteUrl || '',
    npmPackage: npmPkg,
    transport: transport,
    icons: server.icons || [],
    publishedAt: (server._meta && server._meta.publishedAt) || '',
    updatedAt: (server._meta && server._meta.updatedAt) || ''
  };
}

/**
 * Normalize an npm search result into our format
 */
function normalizeNpmEntry(pkg) {
  var obj = pkg.package || pkg;
  return {
    id: (obj.name || '').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase(),
    registryName: obj.name || '',
    name: obj.name || '',
    description: obj.description || '',
    version: obj.version || '',
    source: 'npm',
    repoUrl: (obj.links && obj.links.repository) || '',
    websiteUrl: (obj.links && obj.links.homepage) || '',
    npmPackage: obj.name || '',
    transport: 'stdio',
    icons: [],
    publishedAt: obj.date || '',
    updatedAt: obj.date || ''
  };
}

/**
 * Handle GET /api/skills/search?q=...&source=registry|npm&cursor=...
 * @param {object} ctx - { ROOT, readJSON, path, fs }
 * @param {string} query - search term
 * @param {string} source - 'registry' or 'npm' (default: 'registry')
 * @param {string} cursor - pagination cursor (registry) or offset (npm)
 */
async function handleSkillSearch(ctx, query, source, cursor) {
  if (!query || !query.trim()) {
    return { results: [], nextCursor: null, total: 0 };
  }

  source = source || 'registry';

  try {
    if (source === 'npm') {
      // npm registry search
      var offset = parseInt(cursor) || 0;
      var npmUrl = 'https://registry.npmjs.org/-/v1/search?text=mcp-server+' +
        encodeURIComponent(query) + '&size=20&from=' + offset;
      var npmData = await httpsGetJSON(npmUrl, 15000);
      var npmResults = (npmData.objects || []).map(normalizeNpmEntry);
      var npmTotal = npmData.total || 0;
      var nextOffset = offset + 20 < npmTotal ? String(offset + 20) : null;
      return { results: npmResults, nextCursor: nextOffset, total: npmTotal };
    } else {
      // Official MCP Registry search
      var regUrl = 'https://registry.modelcontextprotocol.io/v0/servers?search=' +
        encodeURIComponent(query) + '&limit=20&version=latest';
      if (cursor) regUrl += '&cursor=' + encodeURIComponent(cursor);
      var regData = await httpsGetJSON(regUrl, 15000);
      var servers = regData.servers || regData || [];
      if (!Array.isArray(servers)) servers = [];
      var regResults = servers.map(normalizeRegistryEntry);
      var nextCursor = (regData.metadata && regData.metadata.nextCursor) || null;
      var total = (regData.metadata && regData.metadata.total) || regResults.length;
      return { results: regResults, nextCursor: nextCursor, total: total };
    }
  } catch(err) {
    return { results: [], nextCursor: null, total: 0, error: err.message };
  }
}

// ── User Skill Install/Uninstall ─────────────────────────

/**
 * Generate a safe skill ID from registry data
 */
function generateSkillId(registryName, npmPackage) {
  var base = npmPackage || registryName || 'skill';
  // Remove scope prefix (@scope/)
  base = base.replace(/^@[^/]+\//, '');
  // Sanitize
  return base.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().slice(0, 50);
}

/**
 * Handle POST /api/skills/user/install
 * @param {object} ctx - { ROOT, readJSON, writeJSON, path, fs, broadcast }
 * @param {object} body - skill data from search results
 */
async function handleUserSkillInstall(ctx, body) {
  if (!body || (!body.npmPackage && !body.repoUrl)) {
    return { error: 'Missing npmPackage or repoUrl', status: 400 };
  }

  var skillId = generateSkillId(body.registryName || body.name, body.npmPackage);

  // Check for duplicates across both catalogs
  var existing = findSkillById(ctx, skillId);
  if (existing) {
    return { error: 'Skill "' + skillId + '" already exists', status: 409 };
  }

  // Build the skill entry
  var skillEntry = {
    id: skillId,
    name: body.name || skillId,
    description: body.description || '',
    icon: '',
    type: 'mcp',
    source: body.source || 'registry',
    sourceId: body.registryName || body.npmPackage || '',
    userInstalled: true,
    version: body.version || '',
    repoUrl: body.repoUrl || '',
    installedAt: new Date().toISOString(),
    packages: [],
    settings: [],
    mcpConfig: null
  };

  // Determine install method
  if (body.npmPackage) {
    // npx-based install - no npm install needed, npx handles it
    skillEntry.mcpConfig = {
      command: 'npx',
      args: ['-y', body.npmPackage]
    };
  } else if (body.repoUrl) {
    // Git-based install
    skillEntry.gitRepo = body.repoUrl;
    skillEntry.buildCmd = 'npm install && npm run build';
    var skillDir = ctx.path.join(ctx.ROOT, 'data/skills/user', skillId);
    ctx.fs.mkdirSync(skillDir, { recursive: true });

    // Clone
    if (!ctx.fs.existsSync(ctx.path.join(skillDir, '.git'))) {
      var cloneResult = await new Promise(function(resolve) {
        var proc = spawn('git', ['clone', body.repoUrl, '.'], { cwd: skillDir, shell: true, timeout: 120000 });
        var output = '';
        proc.stdout.on('data', function(ch) { output += ch; });
        proc.stderr.on('data', function(ch) { output += ch; });
        proc.on('close', function(code) { resolve({ success: code === 0, output: output }); });
        proc.on('error', function(err) { resolve({ success: false, output: err.message }); });
      });
      if (!cloneResult.success) {
        // Clean up
        try { ctx.fs.rmSync(skillDir, { recursive: true, force: true }); } catch(e) {}
        return { ok: false, error: 'Git clone failed.', details: cloneResult.output, status: 500 };
      }
    }

    // Build
    var buildResult = await new Promise(function(resolve) {
      var proc = spawn('npm', ['install'], { cwd: skillDir, shell: true, timeout: 180000 });
      var output = '';
      proc.stdout.on('data', function(ch) { output += ch; });
      proc.stderr.on('data', function(ch) { output += ch; });
      proc.on('close', function(code) { resolve({ success: code === 0, output: output }); });
      proc.on('error', function(err) { resolve({ success: false, output: err.message }); });
    });
    if (!buildResult.success) {
      return { ok: false, error: 'npm install failed for cloned repo.', details: buildResult.output, status: 500 };
    }

    // Try to detect main entry point
    var clonedPkg = ctx.readJSON(ctx.path.join(skillDir, 'package.json'));
    var mainFile = (clonedPkg && (clonedPkg.main || clonedPkg.bin)) || 'index.js';
    if (typeof mainFile === 'object') mainFile = Object.values(mainFile)[0] || 'index.js';
    var fullPath = ctx.path.join(skillDir, mainFile).replace(/\\/g, '/');

    skillEntry.mcpConfig = {
      command: 'node',
      args: [fullPath]
    };
  }

  // Save to user catalog
  var userCatalog = loadUserCatalog(ctx);
  userCatalog.push(skillEntry);
  saveUserCatalog(ctx, userCatalog);

  // Write to .mcp.json
  if (skillEntry.mcpConfig) {
    var mcpPath = ctx.path.join(ctx.ROOT, '.mcp.json');
    var mcpData = ctx.readJSON(mcpPath) || { mcpServers: {} };
    mcpData.mcpServers[skillId] = skillEntry.mcpConfig;
    ctx.writeJSON(mcpPath, mcpData);
  }

  // Set enabled
  var enabledPath = ctx.path.join(ctx.ROOT, 'data/skills/enabled.json');
  var enabled = ctx.readJSON(enabledPath) || {};
  enabled[skillId] = true;
  ctx.writeJSON(enabledPath, enabled);

  ctx.broadcast('skills');
  return { ok: true, skill: skillEntry };
}

/**
 * Handle DELETE /api/skills/user/:id
 * @param {object} ctx - { ROOT, readJSON, writeJSON, path, fs, broadcast }
 * @param {string} skillId
 */
function handleUserSkillUninstall(ctx, skillId) {
  var userCatalog = loadUserCatalog(ctx);
  var skillIndex = userCatalog.findIndex(function(s) { return s.id === skillId; });

  if (skillIndex === -1) {
    return { error: 'User skill not found: ' + skillId, status: 404 };
  }

  var skill = userCatalog[skillIndex];

  // Remove from user catalog
  userCatalog.splice(skillIndex, 1);
  saveUserCatalog(ctx, userCatalog);

  // Remove from .mcp.json
  var mcpPath = ctx.path.join(ctx.ROOT, '.mcp.json');
  var mcpData = ctx.readJSON(mcpPath) || { mcpServers: {} };
  delete mcpData.mcpServers[skillId];
  ctx.writeJSON(mcpPath, mcpData);

  // Remove from enabled.json
  var enabledPath = ctx.path.join(ctx.ROOT, 'data/skills/enabled.json');
  var enabled = ctx.readJSON(enabledPath) || {};
  delete enabled[skillId];
  ctx.writeJSON(enabledPath, enabled);

  // Clean up skill directory if it exists
  var skillDir = ctx.path.join(ctx.ROOT, 'data/skills/user', skillId);
  if (ctx.fs.existsSync(skillDir)) {
    try { ctx.fs.rmSync(skillDir, { recursive: true, force: true }); } catch(e) {}
  }

  // Clean up settings file
  var settingsPath = ctx.path.join(ctx.ROOT, 'data/skills', skillId + '-settings.json');
  if (ctx.fs.existsSync(settingsPath)) {
    try { ctx.fs.unlinkSync(settingsPath); } catch(e) {}
  }

  ctx.broadcast('skills');
  return { ok: true };
}

/**
 * Handle screen recorder control
 * @param {object} ctx - { ROOT, path, fs }
 * @param {string} action - 'start', 'stop', or 'status'
 * @param {object} body - request body for start action
 */
async function handleScreenRecorder(ctx, action, body) {
  var recScript = ctx.path.join(ctx.ROOT, 'data/skills/screen-recorder/record.js');
  if (!ctx.fs.existsSync(recScript)) return { error: 'Screen recorder not installed', status: 404 };

  var recArgs = [recScript, action];
  // For start, pass through body params as flags
  if (action === 'start' && body) {
    if (body.fps) recArgs.push('--fps', String(body.fps));
    if (body.output) recArgs.push('--output', String(body.output));
    if (body.window) recArgs.push('--window', String(body.window));
    if (body.region) recArgs.push('--region', String(body.region));
  }

  var recResult = await new Promise(function(resolve) {
    var proc = spawn('node', recArgs, { cwd: ctx.ROOT, shell: true, timeout: 10000 });
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

  return recResult;
}

/**
 * Get GitHub CLI auth and repo status
 * @param {object} ctx - { ROOT, readJSON, path }
 * @returns {Promise<object>} { authenticated, user, repo }
 */
function getGitHubStatus(ctx) {
  return new Promise(function(resolve) {
    var result = { authenticated: false, user: null, repo: null };
    if (!commandExists('gh')) {
      result.installed = false;
      return resolve(result);
    }
    result.installed = true;
    var proc = spawn('gh', ['auth', 'status', '--active'], { shell: true, timeout: 10000 });
    var out = '';
    proc.stdout.on('data', function(ch) { out += ch; });
    proc.stderr.on('data', function(ch) { out += ch; });
    proc.on('close', function(code) {
      if (code === 0) {
        result.authenticated = true;
        var userMatch = out.match(/Logged in to [^\s]+ account ([^\s(]+)/i) || out.match(/account ([^\s(]+)/i);
        if (userMatch) result.user = userMatch[1];
      }
      // Check default repo if configured
      var settings = ctx.readJSON(ctx.path.join(ctx.ROOT, 'data/skills/github-settings.json')) || {};
      var repo = settings.GITHUB_DEFAULT_REPO;
      if (repo && result.authenticated) {
        var proc2 = spawn('gh', ['repo', 'view', repo, '--json', 'name,owner'], { shell: true, timeout: 10000 });
        var out2 = '';
        proc2.stdout.on('data', function(ch) { out2 += ch; });
        proc2.stderr.on('data', function(ch) { out2 += ch; });
        proc2.on('close', function(code2) {
          if (code2 === 0) {
            try { result.repo = JSON.parse(out2); } catch(e) { result.repo = null; }
          } else {
            result.repoError = 'Could not access ' + repo;
          }
          resolve(result);
        });
        proc2.on('error', function() { resolve(result); });
      } else {
        resolve(result);
      }
    });
    proc.on('error', function() { resolve(result); });
  });
}

/**
 * Get context snippets for enabled skills (for CLAUDE.md injection)
 * @param {object} ctx - { ROOT, readJSON, path }
 * @returns {string} Markdown context for enabled skills
 */
function getEnabledSkillContexts(ctx) {
  var catalog = loadAllCatalogs(ctx);
  var enabled = ctx.readJSON(ctx.path.join(ctx.ROOT, 'data/skills/enabled.json')) || {};
  var snippets = [];
  catalog.forEach(function(s) {
    if (!enabled[s.id] || !s.contextSnippet) return;
    var snippet = s.contextSnippet;
    // Replace setting placeholders
    var settings = ctx.readJSON(ctx.path.join(ctx.ROOT, 'data/skills', s.id + '-settings.json')) || {};
    snippet = snippet.replace(/\{(\w+)\}/g, function(m, key) {
      return settings[key] || '(not configured)';
    });
    snippets.push(snippet);
  });
  return snippets.join('\n\n');
}

module.exports = {
  commandExists,
  getInstallCommand,
  SYSTEM_DEP_MAP,
  installSystemDep,
  handleGetSkills,
  handleSkillSettings,
  handleSkillToggle,
  handleSkillSearch,
  handleUserSkillInstall,
  handleUserSkillUninstall,
  handleScreenRecorder,
  getGitHubStatus,
  getEnabledSkillContexts,
};
