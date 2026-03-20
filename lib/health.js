// ── Health Validation Module ─────────────────────────────
// Checks system integrity on startup and via GET /api/health

function validateSystem(ctx) {
  var issues = [];
  var status = 'ok';

  // 1. Version match: system.json vs package.json
  var systemJson = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/system.json')) || {};
  var packageJson = ctx.readJSON(ctx.path.join(ctx.ROOT, 'package.json')) || {};
  if (systemJson.version && packageJson.version && systemJson.version !== packageJson.version) {
    issues.push({ level: 'warning', check: 'version-match', message: 'system.json version (' + systemJson.version + ') does not match package.json version (' + packageJson.version + '). Migrations may be needed.' });
  }

  // 2. skills-catalog.json exists and is valid JSON
  var catalogPath = ctx.path.join(ctx.ROOT, 'config/skills-catalog.json');
  var catalog = ctx.readJSON(catalogPath);
  if (!catalog) {
    issues.push({ level: 'warning', check: 'skills-catalog', message: 'config/skills-catalog.json is missing or invalid JSON.' });
  } else if (!Array.isArray(catalog)) {
    issues.push({ level: 'warning', check: 'skills-catalog', message: 'config/skills-catalog.json is not an array.' });
  }

  // 3. All agents in registry have corresponding folders
  var registry = ctx.readJSON(ctx.path.join(ctx.ROOT, 'agents/_registry.json'));
  if (registry && Array.isArray(registry.agents)) {
    for (var i = 0; i < registry.agents.length; i++) {
      var agent = registry.agents[i];
      var agentDir = ctx.path.join(ctx.ROOT, 'agents', agent.id);
      if (!ctx.fs.existsSync(agentDir)) {
        issues.push({ level: 'warning', check: 'agent-folder', message: 'Agent "' + agent.name + '" (' + agent.id + ') has no folder at agents/' + agent.id + '/' });
      }
    }
  } else {
    issues.push({ level: 'warning', check: 'agent-registry', message: 'agents/_registry.json is missing or invalid.' });
  }

  // 4. CLAUDE.md exists
  if (!ctx.fs.existsSync(ctx.path.join(ctx.ROOT, 'CLAUDE.md'))) {
    issues.push({ level: 'warning', check: 'claude-md', message: 'CLAUDE.md is missing. Run POST /api/rebuild-context to regenerate.' });
  }

  // 5. No migrationFailed flag
  if (systemJson.migrationFailed) {
    issues.push({ level: 'error', check: 'migration-failed', message: 'A migration previously failed: ' + (systemJson.migrationFailed.migration || 'unknown') + ' - ' + (systemJson.migrationFailed.error || 'unknown error') });
  }

  // 6. No stuck upgrading flag
  if (systemJson.upgrading) {
    issues.push({ level: 'error', check: 'interrupted-upgrade', message: 'System has a stuck "upgrading" flag. An upgrade may have been interrupted. Check POST /api/updates/rollback.' });
  }

  // 7. Required directories exist
  var requiredDirs = ['data/tasks', 'data/knowledge', 'data/media', 'data/skills', 'temp'];
  for (var j = 0; j < requiredDirs.length; j++) {
    var dirPath = ctx.path.join(ctx.ROOT, requiredDirs[j]);
    if (!ctx.fs.existsSync(dirPath)) {
      // Auto-create missing directories
      try {
        ctx.fs.mkdirSync(dirPath, { recursive: true });
        issues.push({ level: 'info', check: 'directory', message: 'Created missing directory: ' + requiredDirs[j] });
      } catch (e) {
        issues.push({ level: 'error', check: 'directory', message: 'Required directory missing and could not be created: ' + requiredDirs[j] });
      }
    }
  }

  // Ensure data/system-notices/ exists
  var noticesDir = ctx.path.join(ctx.ROOT, 'data/system-notices');
  if (!ctx.fs.existsSync(noticesDir)) {
    try {
      ctx.fs.mkdirSync(noticesDir, { recursive: true });
    } catch (e) {
      issues.push({ level: 'warning', check: 'directory', message: 'Could not create data/system-notices/' });
    }
  }

  // 8. agent-os.md exists (critical for agent operations)
  var agentOsPath = ctx.path.join(ctx.ROOT, 'config/agent-os.md');
  if (!ctx.fs.existsSync(agentOsPath)) {
    issues.push({ level: 'error', check: 'agent-os', message: 'config/agent-os.md is missing. Agents cannot function without the Platform OS file.' });
  } else {
    try {
      var agentOsStat = ctx.fs.statSync(agentOsPath);
      if (agentOsStat.size === 0) {
        issues.push({ level: 'error', check: 'agent-os', message: 'config/agent-os.md exists but is empty.' });
      }
    } catch (e) {}
  }

  // 9. team-rules.md exists
  if (!ctx.fs.existsSync(ctx.path.join(ctx.ROOT, 'config/team-rules.md'))) {
    issues.push({ level: 'warning', check: 'team-rules', message: 'config/team-rules.md is missing. CLAUDE.md generation may be incomplete.' });
  }

  // 10. security-rules.md exists
  if (!ctx.fs.existsSync(ctx.path.join(ctx.ROOT, 'config/security-rules.md'))) {
    issues.push({ level: 'warning', check: 'security-rules', message: 'config/security-rules.md is missing. CLAUDE.md generation may be incomplete.' });
  }

  // 11. All agents in registry have agent.md files
  if (registry && Array.isArray(registry.agents)) {
    for (var p = 0; p < registry.agents.length; p++) {
      var agentMdPath = ctx.path.join(ctx.ROOT, 'agents', registry.agents[p].id, 'agent.md');
      if (!ctx.fs.existsSync(agentMdPath)) {
        issues.push({ level: 'warning', check: 'agent-md', message: 'Agent "' + registry.agents[p].name + '" (' + registry.agents[p].id + ') is missing agent.md file.' });
      }
    }
  }

  // 12. enabled.json references only skills that exist in catalog
  if (Array.isArray(catalog)) {
    var catalogIds = {};
    for (var k = 0; k < catalog.length; k++) {
      catalogIds[catalog[k].id] = true;
    }
    var enabledPath = ctx.path.join(ctx.ROOT, 'data/skills/enabled.json');
    var enabled = ctx.readJSON(enabledPath);
    if (enabled && typeof enabled === 'object') {
      var enabledKeys = Object.keys(enabled);
      for (var m = 0; m < enabledKeys.length; m++) {
        if (!catalogIds[enabledKeys[m]]) {
          issues.push({ level: 'warning', check: 'skills-enabled', message: 'Enabled skill "' + enabledKeys[m] + '" not found in skills-catalog.json.' });
        }
      }
    }
  }

  // Determine overall status
  for (var n = 0; n < issues.length; n++) {
    if (issues[n].level === 'error') { status = 'error'; break; }
    if (issues[n].level === 'warning') { status = 'warning'; }
  }

  // Check for upgrade-pending flag
  var upgradePending = null;
  var upgradeFlagPath = ctx.path.join(ctx.ROOT, 'config/.upgrade-pending');
  if (ctx.fs.existsSync(upgradeFlagPath)) {
    try {
      upgradePending = JSON.parse(ctx.fs.readFileSync(upgradeFlagPath, 'utf8'));
    } catch (e) {
      upgradePending = { error: 'Could not parse .upgrade-pending file' };
    }
  }

  var result = {
    status: status,
    issues: issues,
    checkedAt: new Date().toISOString(),
    upgradePending: upgradePending
  };

  // Store in system.json
  systemJson.health = result;
  ctx.writeJSON(ctx.path.join(ctx.ROOT, 'config/system.json'), systemJson);

  return result;
}

// ── System Notices ──────────────────────────────────────

function listNotices(ctx) {
  var noticesDir = ctx.path.join(ctx.ROOT, 'data/system-notices');
  if (!ctx.fs.existsSync(noticesDir)) return [];

  var dismissedPath = ctx.path.join(noticesDir, 'dismissed.json');
  var dismissed = ctx.readJSON(dismissedPath) || {};

  var files;
  try {
    files = ctx.fs.readdirSync(noticesDir);
  } catch (e) {
    return [];
  }

  var notices = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f.endsWith('.md')) continue;

    var fp = ctx.path.join(noticesDir, f);
    var stat;
    try { stat = ctx.fs.statSync(fp); } catch (e) { continue; }

    var content;
    try { content = ctx.fs.readFileSync(fp, 'utf8'); } catch (e) { content = ''; }

    // Title is the first line (strip leading #)
    var firstLine = (content.split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    var id = f.replace(/\.md$/, '');

    notices.push({
      id: id,
      filename: f,
      title: firstLine || f,
      content: content,
      createdAt: stat.mtime.toISOString(),
      dismissed: !!dismissed[id]
    });
  }

  // Sort newest first
  notices.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  return notices;
}

function dismissNotice(ctx, noticeId) {
  var noticesDir = ctx.path.join(ctx.ROOT, 'data/system-notices');
  var dismissedPath = ctx.path.join(noticesDir, 'dismissed.json');
  var dismissed = ctx.readJSON(dismissedPath) || {};
  dismissed[noticeId] = new Date().toISOString();
  ctx.writeJSON(dismissedPath, dismissed);
  return { ok: true };
}

module.exports = {
  validateSystem: validateSystem,
  listNotices: listNotices,
  dismissNotice: dismissNotice
};
