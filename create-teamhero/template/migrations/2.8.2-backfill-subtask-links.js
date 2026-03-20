// Migration: 2.8.2 - Backfill missing subtask links
// Scans all tasks with parentTaskId set and ensures the parent's subtasks[]
// array contains the child task ID.

module.exports = function(ctx) {
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var index = ctx.readJSON(indexPath);
  if (!index || !index.tasks) {
    ctx.log('  Migration 2.8.2: No task index found, skipping.');
    return;
  }

  var fixed = 0;
  var parentCache = {};

  index.tasks.forEach(function(entry) {
    if (!entry.parentTaskId) return;

    var parentId = entry.parentTaskId;
    var childId = entry.id;

    // Load parent task (use cache to avoid re-reading)
    if (!parentCache[parentId]) {
      var parentPath = ctx.path.join(ctx.ROOT, 'data/tasks', parentId, 'task.json');
      var parentTask = ctx.readJSON(parentPath);
      if (!parentTask) return;
      parentCache[parentId] = { task: parentTask, dirty: false };
    }

    var cached = parentCache[parentId];
    if (!cached.task.subtasks) cached.task.subtasks = [];
    if (cached.task.subtasks.indexOf(childId) === -1) {
      cached.task.subtasks.push(childId);
      cached.dirty = true;
      fixed++;
      ctx.log('  Linked child ' + childId + ' -> parent ' + parentId);
    }
  });

  // Write back all modified parents
  Object.keys(parentCache).forEach(function(parentId) {
    var cached = parentCache[parentId];
    if (cached.dirty) {
      var parentPath = ctx.path.join(ctx.ROOT, 'data/tasks', parentId, 'task.json');
      cached.task.updatedAt = new Date().toISOString();
      ctx.writeJSON(parentPath, cached.task);
    }
  });

  ctx.log('  Migration 2.8.2: Backfilled ' + fixed + ' missing subtask links.');
};
