// ── Upgrade / Update Mechanism (GitHub Releases) ─────────
// Full upgrade flow: pre-checks, backup, download, migrate, rebuild, rollback

var GITHUB_REPO = 'sagiyaacoby/TeamHero';
// User data paths - NEVER overwritten during upgrade.
// Everything else in the tarball is platform code and gets extracted.
var USER_DATA_PATHS = [
  'data/',
  'agents/',
  'profile/',
  'temp/',
  'CLAUDE.md',
  'config/team-rules.md',
  'config/security-rules.md',
  'config/system.json',
];

// Legacy list kept for backward compatibility (deprecated - use USER_DATA_PATHS instead)
var PLATFORM_FILES = [
  'server.js', 'portal/', 'launch.sh', 'launch.bat',
  'config/agent-templates/', 'config/skills-catalog.json',
  '.gitignore', 'package.json', 'package-lock.json',
  'migrations/', 'lib/',
];

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

/**
 * @param {object} ctx - { ROOT, readJSON, path, fs }
 */
async function checkForUpdates(ctx) {
  var localPkg = ctx.readJSON(ctx.path.join(ctx.ROOT, 'package.json'));
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

// ── Pre-upgrade: Check for active tasks ──────────────────

function checkActiveTasks(ctx) {
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var index = ctx.readJSON(indexPath);
  if (!index || !index.tasks) return [];
  return index.tasks.filter(function(t) {
    return t.status === 'working';
  }).map(function(t) {
    return { id: t.id, title: t.title, assignedTo: t.assignedTo };
  });
}

// ── Pre-upgrade: Backup platform files ───────────────────

function backupPlatformFiles(ctx, version) {
  var backupDir = ctx.path.join(ctx.ROOT, 'data/backups/v' + version);
  ctx.fs.mkdirSync(backupDir, { recursive: true });

  // Dynamically discover all platform files (everything not in USER_DATA_PATHS)
  var backedUp = 0;
  var entries = ctx.fs.readdirSync(ctx.ROOT, { withFileTypes: true });
  entries.forEach(function(entry) {
    var rel = entry.isDirectory() ? entry.name + '/' : entry.name;
    // Skip user data paths
    var isUserData = USER_DATA_PATHS.some(function(ud) {
      if (ud.endsWith('/')) return rel.startsWith(ud) || rel === ud;
      return rel === ud;
    });
    // Also skip node_modules, .git, data/, backups
    if (isUserData || rel === 'node_modules/' || rel === '.git/' || rel === 'data/') return;

    var srcPath = ctx.path.join(ctx.ROOT, entry.name);
    var destPath = ctx.path.join(backupDir, entry.name);

    if (entry.isDirectory()) {
      if (ctx.fs.existsSync(srcPath)) {
        copyDirRecursive(ctx, srcPath, destPath);
        backedUp++;
      }
    } else {
      ctx.fs.mkdirSync(ctx.path.dirname(destPath), { recursive: true });
      ctx.fs.copyFileSync(srcPath, destPath);
      backedUp++;
    }
  });

  return backedUp;
}

function copyDirRecursive(ctx, src, dest) {
  if (!ctx.fs.existsSync(src)) return;
  ctx.fs.mkdirSync(dest, { recursive: true });
  var entries = ctx.fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var s = ctx.path.join(src, entries[i].name);
    var d = ctx.path.join(dest, entries[i].name);
    if (entries[i].isDirectory()) copyDirRecursive(ctx, s, d);
    else ctx.fs.copyFileSync(s, d);
  }
}

// ── Pre-upgrade: Set upgrading lock ──────────────────────

function setUpgradingLock(ctx, value) {
  var sysPath = ctx.path.join(ctx.ROOT, 'config/system.json');
  var sys = ctx.readJSON(sysPath) || {};
  sys.upgrading = value;
  ctx.writeJSON(sysPath, sys);
}

// ── Tar extraction (shared between upgrade and rollback) ─

function extractTarball(ctx, tarData) {
  var extracted = 0;
  var extractedPaths = [];
  var offset = 0;
  var stripPrefix = '';

  while (offset < tarData.length) {
    var header = tarData.slice(offset, offset + 512);
    if (header.length < 512 || header[0] === 0) break;

    var fileName = header.slice(0, 100).toString('utf8').replace(/\0/g, '');
    var prefix = header.slice(345, 500).toString('utf8').replace(/\0/g, '');
    if (prefix) fileName = prefix + '/' + fileName;

    var sizeOctal = header.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
    var fileSize = parseInt(sizeOctal, 8) || 0;
    var typeFlag = header[156];

    offset += 512;

    if (!stripPrefix && fileName.indexOf('/') > 0) {
      stripPrefix = fileName.slice(0, fileName.indexOf('/') + 1);
    }

    var relPath = fileName;
    if (stripPrefix && relPath.startsWith(stripPrefix)) {
      relPath = relPath.slice(stripPrefix.length);
    }

    if (relPath && fileSize > 0 && typeFlag === 48) {
      // Exclude-list: skip user data, extract everything else
      var isUserData = USER_DATA_PATHS.some(function(ud) {
        if (ud.endsWith('/')) return relPath.startsWith(ud);
        return relPath === ud;
      });

      if (!isUserData) {
        var fileData = tarData.slice(offset, offset + fileSize);
        var destPath = ctx.path.join(ctx.ROOT, relPath);
        ctx.fs.mkdirSync(ctx.path.dirname(destPath), { recursive: true });
        ctx.fs.writeFileSync(destPath, fileData);
        extracted++;
        extractedPaths.push(relPath);
      }
    }

    offset += Math.ceil(fileSize / 512) * 512;
  }

  return { count: extracted, paths: extractedPaths };
}

// ── Post-upgrade: Write system notice ────────────────────

function writeUpgradeNotice(ctx, fromVersion, toVersion, migrationsRan, filesUpdated, releaseNotes) {
  var noticesDir = ctx.path.join(ctx.ROOT, 'data/system-notices');
  ctx.fs.mkdirSync(noticesDir, { recursive: true });

  var content = '# Upgrade Notice: v' + fromVersion + ' -> v' + toVersion + '\n\n' +
    '**Date:** ' + new Date().toISOString() + '\n\n' +
    '## Changes\n' +
    (releaseNotes || 'No release notes available.') + '\n\n' +
    '## Stats\n' +
    '- Files updated: ' + filesUpdated + '\n' +
    '- Migrations run: ' + migrationsRan + '\n';

  var noticePath = ctx.path.join(noticesDir, 'upgrade-' + toVersion + '.md');
  ctx.fs.writeFileSync(noticePath, content);
}

// ── Main upgrade function ────────────────────────────────

/**
 * @param {object} ctx - { ROOT, readJSON, writeJSON, path, fs, broadcast, rebuildClaudeMd }
 * @param {object} [opts] - { force: boolean } - force upgrade even with active tasks
 */
async function performUpgrade(ctx, opts) {
  opts = opts || {};
  var sysPath = ctx.path.join(ctx.ROOT, 'config/system.json');

  // Step 1: Check for updates
  var check = await checkForUpdates(ctx);
  if (!check.updateAvailable) return { success: false, message: 'Already up to date.' };
  if (!check.tarballUrl) return { success: false, message: 'No download URL available.' };

  var fromVersion = check.currentVersion;
  var toVersion = check.latestVersion;

  // Step 2: Pre-upgrade checks - active tasks
  if (!opts.force) {
    var activeTasks = checkActiveTasks(ctx);
    if (activeTasks.length > 0) {
      return {
        success: false,
        message: 'Active tasks detected. Use force=true to override.',
        activeTasks: activeTasks,
        requiresForce: true,
      };
    }
  }

  try {
    // Step 3: Set upgrading lock
    setUpgradingLock(ctx, true);

    // Step 4: Backup current platform files
    var backedUpCount = backupPlatformFiles(ctx, fromVersion);
    console.log('  Upgrade: Backed up ' + backedUpCount + ' items to data/backups/v' + fromVersion);

    // Step 5: Download the release tarball
    var tarRes = await httpsGet(check.tarballUrl);
    if (tarRes.statusCode !== 200) {
      setUpgradingLock(ctx, false);
      return { success: false, message: 'Download failed: HTTP ' + tarRes.statusCode };
    }

    var zlib = require('zlib');
    var tarData = zlib.gunzipSync(tarRes.body);

    // Step 6: Extract platform files
    var extraction = extractTarball(ctx, tarData);
    console.log('  Upgrade: Extracted ' + extraction.count + ' files');

    // Step 7: Run migrations
    var migrationsResult = { ran: 0, failed: false };
    try {
      // Re-require migrations module to pick up any new migration files
      delete require.cache[require.resolve('./migrations')];
      var migrationsModule = require('./migrations');
      migrationsResult = migrationsModule.runPendingMigrations(ctx);
    } catch(migErr) {
      console.error('  Upgrade: Migration error: ' + migErr.message);
      migrationsResult = { ran: 0, failed: true, error: migErr.message };
    }

    if (migrationsResult.failed) {
      // Migrations failed - leave upgrading lock for recovery
      var sys = ctx.readJSON(sysPath) || {};
      sys.lastUpgrade = {
        version: toVersion,
        date: new Date().toISOString(),
        migrationsRun: migrationsResult.ran,
        filesUpdated: extraction.count,
        migrationFailed: true,
      };
      ctx.writeJSON(sysPath, sys);

      return {
        success: false,
        message: 'Upgrade files extracted but migrations failed. System may be in inconsistent state. Use rollback to restore.',
        fromVersion: fromVersion,
        toVersion: toVersion,
        migrationsRun: migrationsResult.ran,
        filesUpdated: extraction.count,
        migrationFailed: true,
        restartRequired: true,
      };
    }

    // Step 8: Rebuild CLAUDE.md
    if (typeof ctx.rebuildClaudeMd === 'function') {
      try { ctx.rebuildClaudeMd(); } catch(e) {
        console.error('  Upgrade: CLAUDE.md rebuild error: ' + e.message);
      }
    }

    // Step 9: Sync system.json version
    var sys = ctx.readJSON(sysPath) || {};
    sys.version = toVersion;

    // Step 10: Clear upgrading lock
    sys.upgrading = false;

    // Step 11: Record lastUpgrade
    sys.lastUpgrade = {
      version: toVersion,
      date: new Date().toISOString(),
      migrationsRun: migrationsResult.ran,
      filesUpdated: extraction.count,
    };

    delete sys.migrationFailed;
    ctx.writeJSON(sysPath, sys);

    // Step 12: Write upgrade notice
    writeUpgradeNotice(ctx, fromVersion, toVersion, migrationsResult.ran, extraction.count, check.releaseNotes);

    console.log('  Upgrade: Complete. v' + fromVersion + ' -> v' + toVersion);

    return {
      success: true,
      message: 'Updated to v' + toVersion + '. ' + extraction.count + ' files updated, ' + migrationsResult.ran + ' migrations run. Restart the server to apply.',
      fromVersion: fromVersion,
      toVersion: toVersion,
      migrationsRun: migrationsResult.ran,
      filesUpdated: extraction.count,
      restartRequired: true,
      changelog: check.releaseNotes || '',
      extractedFiles: extraction.count, // backward compat
    };
  } catch(e) {
    // Clear lock on unexpected error
    try { setUpgradingLock(ctx, false); } catch(lockErr) {}
    return { success: false, message: 'Upgrade failed: ' + e.message };
  }
}

// ── Rollback ─────────────────────────────────────────────

/**
 * Restore platform files from a backup.
 * @param {object} ctx - { ROOT, readJSON, writeJSON, path, fs }
 * @param {string} [version] - version to rollback to. If omitted, uses lastUpgrade info or latest backup.
 */
function rollback(ctx, version) {
  var sysPath = ctx.path.join(ctx.ROOT, 'config/system.json');
  var sys = ctx.readJSON(sysPath) || {};

  // Determine which backup to restore
  if (!version) {
    // Try to infer from lastUpgrade or find latest backup
    if (sys.lastUpgrade && sys.lastUpgrade.version) {
      // lastUpgrade.version is the version we upgraded TO, we want to restore FROM before that
      // Look for backup directories
      var backupsDir = ctx.path.join(ctx.ROOT, 'data/backups');
      if (!ctx.fs.existsSync(backupsDir)) {
        return { success: false, message: 'No backups found.' };
      }
      var backups = ctx.fs.readdirSync(backupsDir).filter(function(d) {
        return d.startsWith('v');
      }).sort(function(a, b) {
        return compareVersions(a.slice(1), b.slice(1));
      });
      if (backups.length === 0) {
        return { success: false, message: 'No backups found.' };
      }
      // Use the latest backup (highest version)
      version = backups[backups.length - 1].slice(1);
    } else {
      return { success: false, message: 'No version specified and no upgrade history found.' };
    }
  }

  var backupDir = ctx.path.join(ctx.ROOT, 'data/backups/v' + version);
  if (!ctx.fs.existsSync(backupDir)) {
    return { success: false, message: 'Backup for v' + version + ' not found.' };
  }

  var restored = 0;
  try {
    // Dynamically restore everything found in the backup directory
    var backupEntries = ctx.fs.readdirSync(backupDir, { withFileTypes: true });
    backupEntries.forEach(function(entry) {
      var srcPath = ctx.path.join(backupDir, entry.name);
      var destPath = ctx.path.join(ctx.ROOT, entry.name);

      if (entry.isDirectory()) {
        // Remove current directory first, then copy backup
        if (ctx.fs.existsSync(destPath)) {
          ctx.fs.rmSync(destPath, { recursive: true, force: true });
        }
        copyDirRecursive(ctx, srcPath, destPath);
        restored++;
      } else {
        ctx.fs.mkdirSync(ctx.path.dirname(destPath), { recursive: true });
        ctx.fs.copyFileSync(srcPath, destPath);
        restored++;
      }
    });

    // Update system.json
    sys.version = version;
    sys.upgrading = false;
    delete sys.migrationFailed;
    sys.lastRollback = {
      version: version,
      date: new Date().toISOString(),
      filesRestored: restored,
    };
    ctx.writeJSON(sysPath, sys);

    console.log('  Rollback: Restored ' + restored + ' items from v' + version + ' backup');

    return {
      success: true,
      message: 'Rolled back to v' + version + '. ' + restored + ' items restored. Restart the server to apply.',
      version: version,
      filesRestored: restored,
      restartRequired: true,
    };
  } catch(e) {
    return { success: false, message: 'Rollback failed: ' + e.message };
  }
}

// ── Interrupted upgrade recovery ─────────────────────────

/**
 * Check if an upgrade was interrupted (system.json.upgrading = true on startup).
 * @param {object} ctx - { ROOT, readJSON, path }
 * @returns {object|null} - info about the interrupted state, or null if clean
 */
function checkInterruptedUpgrade(ctx) {
  var sysPath = ctx.path.join(ctx.ROOT, 'config/system.json');
  var sys = ctx.readJSON(sysPath) || {};

  if (!sys.upgrading) return null;

  var result = {
    interrupted: true,
    currentVersion: sys.version || 'unknown',
    lastUpgrade: sys.lastUpgrade || null,
    migrationFailed: sys.migrationFailed || null,
  };

  // Check if there's a backup available for rollback
  var backupsDir = ctx.path.join(ctx.ROOT, 'data/backups');
  if (ctx.fs.existsSync(backupsDir)) {
    var backups = ctx.fs.readdirSync(backupsDir).filter(function(d) {
      return d.startsWith('v');
    });
    result.availableBackups = backups.map(function(d) { return d.slice(1); });
  } else {
    result.availableBackups = [];
  }

  return result;
}

// ── Update status (for GET /api/updates/status) ──────────

function getUpdateStatus(ctx) {
  var sysPath = ctx.path.join(ctx.ROOT, 'config/system.json');
  var sys = ctx.readJSON(sysPath) || {};

  return {
    upgrading: sys.upgrading || false,
    lastUpgrade: sys.lastUpgrade || null,
    migrationFailed: sys.migrationFailed || null,
    lastRollback: sys.lastRollback || null,
    version: sys.version || 'unknown',
  };
}

module.exports = {
  GITHUB_REPO,
  PLATFORM_FILES, // deprecated - kept for backward compatibility
  USER_DATA_PATHS,
  httpsGet,
  compareVersions,
  checkForUpdates,
  performUpgrade,
  rollback,
  checkInterruptedUpgrade,
  getUpdateStatus,
};
