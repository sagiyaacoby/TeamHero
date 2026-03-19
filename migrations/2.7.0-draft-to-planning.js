// Migration: 2.7.0 - Convert draft status to planning
// Non-destructive: only changes status values from "draft" to "planning"

module.exports = function(ctx) {
  var changed = 0;

  // 1. Update _index.json
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  if (ctx.fs.existsSync(indexPath)) {
    var index = ctx.readJSON(indexPath);
    if (index && index.tasks) {
      var indexChanged = false;
      index.tasks.forEach(function(t) {
        if (t.status === 'draft') {
          t.status = 'planning';
          indexChanged = true;
          changed++;
        }
      });
      if (indexChanged) {
        ctx.writeJSON(indexPath, index);
      }
    }
  }

  // 2. Scan each task.json
  var tasksDir = ctx.path.join(ctx.ROOT, 'data/tasks');
  if (ctx.fs.existsSync(tasksDir)) {
    var entries = ctx.fs.readdirSync(tasksDir);
    entries.forEach(function(entry) {
      if (entry === '_index.json') return;
      var taskJsonPath = ctx.path.join(tasksDir, entry, 'task.json');
      if (ctx.fs.existsSync(taskJsonPath)) {
        var task = ctx.readJSON(taskJsonPath);
        if (task && task.status === 'draft') {
          task.status = 'planning';
          ctx.writeJSON(taskJsonPath, task);
          changed++;
        }

        // 3. Scan version folders (v1, v2, etc.)
        var taskDir = ctx.path.join(tasksDir, entry);
        var subEntries = ctx.fs.readdirSync(taskDir);
        subEntries.forEach(function(sub) {
          if (/^v\d+$/.test(sub)) {
            var versionJsonPath = ctx.path.join(taskDir, sub, 'version.json');
            if (ctx.fs.existsSync(versionJsonPath)) {
              var version = ctx.readJSON(versionJsonPath);
              if (version && version.status === 'draft') {
                version.status = 'planning';
                ctx.writeJSON(versionJsonPath, version);
                changed++;
              }
            }
          }
        });
      }
    });
  }

  ctx.log('  Migration 2.7.0: converted draft -> planning in ' + changed + ' records');
};
