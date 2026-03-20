// Migration: 2.7.0 - Normalize deprecated statuses
// Non-destructive: only changes status values
// Mappings: draft -> planning, done -> closed, on_hold -> hold

module.exports = function(ctx) {
  var changed = 0;

  var STATUS_MAP = {
    'draft': 'planning',
    'done': 'closed',
    'on_hold': 'hold'
  };

  function migrateStatus(obj) {
    if (obj && obj.status && STATUS_MAP[obj.status]) {
      var oldStatus = obj.status;
      obj.status = STATUS_MAP[oldStatus];
      changed++;
      return true;
    }
    return false;
  }

  // 1. Update _index.json
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  if (ctx.fs.existsSync(indexPath)) {
    var index = ctx.readJSON(indexPath);
    if (index && index.tasks) {
      var indexChanged = false;
      index.tasks.forEach(function(t) {
        if (migrateStatus(t)) {
          indexChanged = true;
        }
      });
      if (indexChanged) {
        ctx.writeJSON(indexPath, index);
      }
    }
  }

  // 2. Scan each task.json and version folders
  var tasksDir = ctx.path.join(ctx.ROOT, 'data/tasks');
  if (ctx.fs.existsSync(tasksDir)) {
    var entries = ctx.fs.readdirSync(tasksDir);
    entries.forEach(function(entry) {
      if (entry === '_index.json') return;
      var taskJsonPath = ctx.path.join(tasksDir, entry, 'task.json');
      if (ctx.fs.existsSync(taskJsonPath)) {
        var task = ctx.readJSON(taskJsonPath);
        if (migrateStatus(task)) {
          ctx.writeJSON(taskJsonPath, task);
        }

        // 3. Scan version folders (v1, v2, etc.)
        var taskDir = ctx.path.join(tasksDir, entry);
        var subEntries = ctx.fs.readdirSync(taskDir);
        subEntries.forEach(function(sub) {
          if (/^v\d+$/.test(sub)) {
            var versionJsonPath = ctx.path.join(taskDir, sub, 'version.json');
            if (ctx.fs.existsSync(versionJsonPath)) {
              var version = ctx.readJSON(versionJsonPath);
              if (migrateStatus(version)) {
                ctx.writeJSON(versionJsonPath, version);
              }
            }
          }
        });
      }
    });
  }

  ctx.log('  Migration 2.7.0: normalized statuses (draft->planning, done->closed, on_hold->hold) in ' + changed + ' records');
};
