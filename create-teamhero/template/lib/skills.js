// ── Skills Management ────────────────────────────────────
// Extracted from server.js - zero behavior change

const { execSync, spawn } = require('child_process');

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

/**
 * Handle GET /api/skills
 * @param {object} ctx - { ROOT, readJSON, path, fs }
 */
function handleGetSkills(ctx) {
  var catalog = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/skills-catalog.json')) || [];
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

  // Update .mcp.json env vars with actual values
  var catalog = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/skills-catalog.json')) || [];
  var skill = catalog.find(function(s) { return s.id === skillId; });
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
  var catalog = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/skills-catalog.json')) || [];
  var skill = catalog.find(function(s) { return s.id === skillId; });
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
  var catalog = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/skills-catalog.json')) || [];
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
  handleScreenRecorder,
  getGitHubStatus,
  getEnabledSkillContexts,
};
