// ── Migration Engine ─────────────────────────────────────
// Runs numbered migrations between system.json.version and package.json version.
// Each migration is idempotent and non-destructive.

var migrationRegistry = require('../migrations/index');
var upgradeLib = require('./upgrade');

/**
 * Legacy migration: done -> closed, approved -> accepted
 * Kept for backwards compatibility with very old installations.
 * @param {object} ctx - { ROOT, readJSON, writeJSON, path }
 */
function migrateTaskStatuses(ctx) {
  var sys = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/system.json')) || {};
  if (sys.migrationDoneToClosedV3) return;
  var ip = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var ix = ctx.readJSON(ip);
  if (!ix || !ix.tasks) return;
  var changed = false;
  ix.tasks.forEach(function(t) {
    if (t.status === 'done') { t.status = 'closed'; changed = true; }
  });
  if (changed) {
    ctx.writeJSON(ip, ix);
    ix.tasks.forEach(function(t) {
      if (t.status === 'closed') {
        var tp = ctx.path.join(ctx.ROOT, 'data/tasks', t.id, 'task.json');
        var task = ctx.readJSON(tp);
        if (task && task.status === 'done') {
          task.status = 'closed';
          ctx.writeJSON(tp, task);
        }
      }
    });
  }
  sys.migrationDoneToClosedV3 = true;
  ctx.writeJSON(ctx.path.join(ctx.ROOT, 'config/system.json'), sys);
  if (changed) console.log('  Migration: done -> closed completed.');
}

/**
 * Run all pending migrations between current version and target version.
 * @param {object} ctx - sharedCtx from server.js
 * @returns {object} { ran: number, failed: boolean }
 */
function runPendingMigrations(ctx) {
  // Always run the legacy migration first
  migrateTaskStatuses(ctx);

  var sysPath = ctx.path.join(ctx.ROOT, 'config/system.json');
  var sys = ctx.readJSON(sysPath) || {};
  var pkg = ctx.readJSON(ctx.path.join(ctx.ROOT, 'package.json'));
  var currentVersion = sys.version || '0.0.0';
  var targetVersion = pkg ? pkg.version : currentVersion;

  // Nothing to do if versions match
  if (upgradeLib.compareVersions(currentVersion, targetVersion) <= 0) {
    return { ran: 0, failed: false };
  }

  // Ensure migrationsRun tracking array exists
  if (!Array.isArray(sys.migrationsRun)) {
    sys.migrationsRun = [];
  }

  // Find migrations that need to run:
  // - Version is greater than current system version
  // - Version is less than or equal to target version
  // - Not already in migrationsRun
  var pending = migrationRegistry.filter(function(m) {
    // Skip if already run
    if (sys.migrationsRun.indexOf(m.name) >= 0) return false;
    // compareVersions(a, b) returns >0 if b is newer than a
    // m.version must be newer than currentVersion: compareVersions(current, m) > 0
    // m.version must be <= targetVersion: compareVersions(m, target) >= 0
    var newerThanCurrent = upgradeLib.compareVersions(currentVersion, m.version) > 0;
    var notBeyondTarget = upgradeLib.compareVersions(m.version, targetVersion) >= 0;
    return newerThanCurrent && notBeyondTarget;
  });

  if (pending.length === 0) {
    // No migrations needed but version is behind - just update it
    sys.version = targetVersion;
    delete sys.migrationFailed;
    ctx.writeJSON(sysPath, sys);
    return { ran: 0, failed: false };
  }

  console.log('  Running ' + pending.length + ' migration(s) from v' + currentVersion + ' to v' + targetVersion + '...');

  var migCtx = {
    ROOT: ctx.ROOT,
    readJSON: ctx.readJSON,
    writeJSON: ctx.writeJSON,
    path: ctx.path,
    fs: ctx.fs,
    log: function(msg) { console.log(msg); },
  };

  var ranCount = 0;
  for (var i = 0; i < pending.length; i++) {
    var m = pending[i];
    try {
      m.run(migCtx);
      sys.migrationsRun.push(m.name);
      ranCount++;
      console.log('  Migration ' + m.version + ' (' + m.name + ') completed.');
    } catch(err) {
      console.error('  Migration ' + m.version + ' (' + m.name + ') FAILED: ' + err.message);
      sys.migrationFailed = {
        migration: m.name,
        version: m.version,
        error: err.message,
        date: new Date().toISOString(),
      };
      ctx.writeJSON(sysPath, sys);
      return { ran: ranCount, failed: true };
    }
  }

  // All migrations succeeded - update version
  sys.version = targetVersion;
  delete sys.migrationFailed;
  ctx.writeJSON(sysPath, sys);
  console.log('  All migrations completed. System version updated to v' + targetVersion + '.');

  return { ran: ranCount, failed: false };
}

module.exports = {
  migrateTaskStatuses,
  runMigrations: runPendingMigrations,
  runPendingMigrations,
};
