// Migration: 2.5.0 - Add blocker and progressLog fields to tasks
// Non-destructive: only adds fields if they don't exist

module.exports = function(ctx) {
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var index = ctx.readJSON(indexPath);
  if (!index || !index.tasks) return;

  var changed = false;
  index.tasks.forEach(function(t) {
    var needsUpdate = false;
    if (t.blocker === undefined) { t.blocker = null; needsUpdate = true; }
    if (!needsUpdate) return;

    // Update individual task.json
    var tp = ctx.path.join(ctx.ROOT, 'data/tasks', t.id, 'task.json');
    var task = ctx.readJSON(tp);
    if (!task) return;
    if (task.blocker === undefined) { task.blocker = null; changed = true; }
    if (task.progressLog === undefined) { task.progressLog = []; changed = true; }
    ctx.writeJSON(tp, task);
  });

  // Update index too
  if (changed) ctx.writeJSON(indexPath, index);
  ctx.log('  Migration 2.5.0: blocker/progressLog fields ensured on all tasks.');
};
