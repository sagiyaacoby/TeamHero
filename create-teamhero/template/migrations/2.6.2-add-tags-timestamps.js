// Migration: 2.6.2 - Add tags, dueDate, and timestamps to tasks
// Non-destructive: only adds fields if they don't exist; uses file mtime as fallback for timestamps

module.exports = function(ctx) {
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var index = ctx.readJSON(indexPath);
  if (!index || !index.tasks) return;

  var indexChanged = false;
  index.tasks.forEach(function(t) {
    var tp = ctx.path.join(ctx.ROOT, 'data/tasks', t.id, 'task.json');
    var task = ctx.readJSON(tp);
    if (!task) return;

    var changed = false;

    if (task.tags === undefined) { task.tags = []; changed = true; }
    if (task.dueDate === undefined) { task.dueDate = null; changed = true; }

    if (!task.createdAt || !task.updatedAt) {
      // Use file mtime as fallback
      var fallbackDate;
      try {
        var stat = ctx.fs.statSync(tp);
        fallbackDate = stat.mtime.toISOString();
      } catch(e) {
        fallbackDate = new Date().toISOString();
      }
      if (!task.createdAt) { task.createdAt = fallbackDate; changed = true; }
      if (!task.updatedAt) { task.updatedAt = fallbackDate; changed = true; }
    }

    if (changed) {
      ctx.writeJSON(tp, task);
      // Sync to index entry
      if (t.tags === undefined) { t.tags = []; indexChanged = true; }
      if (t.dueDate === undefined) { t.dueDate = null; indexChanged = true; }
      if (!t.createdAt) { t.createdAt = task.createdAt; indexChanged = true; }
      if (!t.updatedAt) { t.updatedAt = task.updatedAt; indexChanged = true; }
    }
  });

  if (indexChanged) ctx.writeJSON(indexPath, index);
  ctx.log('  Migration 2.6.2: tags/dueDate/timestamps ensured on all tasks.');
};
