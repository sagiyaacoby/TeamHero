// Migration: 2.9.1 - Add agentHistory array to all tasks
// Non-destructive: only adds field if missing

module.exports = function(ctx) {
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var index = ctx.readJSON(indexPath);
  if (!index || !index.tasks) return;

  var count = 0;
  index.tasks.forEach(function(t) {
    var tp = ctx.path.join(ctx.ROOT, 'data/tasks', t.id, 'task.json');
    var task = ctx.readJSON(tp);
    if (!task) return;
    if (task.agentHistory !== undefined) return;
    task.agentHistory = [];
    // Seed with current assignee if present
    if (task.assignedTo) {
      task.agentHistory.push({ agentId: task.assignedTo, stage: task.status || 'planning', at: task.createdAt || new Date().toISOString() });
    }
    ctx.writeJSON(tp, task);
    count++;
  });

  // Also check archived tasks
  var archivePath = ctx.path.join(ctx.ROOT, 'data/tasks/_index-archive.json');
  var archive = ctx.readJSON(archivePath);
  if (archive && archive.tasks) {
    archive.tasks.forEach(function(t) {
      var tp = ctx.path.join(ctx.ROOT, 'data/tasks', t.id, 'task.json');
      var task = ctx.readJSON(tp);
      if (!task) return;
      if (task.agentHistory !== undefined) return;
      task.agentHistory = [];
      if (task.assignedTo) {
        task.agentHistory.push({ agentId: task.assignedTo, stage: task.status || 'planning', at: task.createdAt || new Date().toISOString() });
      }
      ctx.writeJSON(tp, task);
      count++;
    });
  }

  ctx.log('  Migration 2.9.1: agentHistory added to ' + count + ' tasks.');
};
