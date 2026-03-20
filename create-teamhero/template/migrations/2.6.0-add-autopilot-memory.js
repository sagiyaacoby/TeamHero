// Migration: 2.6.0 - Add autopilot, subtask fields, and agent memory files
// Non-destructive: only adds fields/files if they don't exist

module.exports = function(ctx) {
  // ── Task fields ──
  var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var index = ctx.readJSON(indexPath);
  if (index && index.tasks) {
    var indexChanged = false;
    index.tasks.forEach(function(t) {
      var tp = ctx.path.join(ctx.ROOT, 'data/tasks', t.id, 'task.json');
      var task = ctx.readJSON(tp);
      if (!task) return;
      var changed = false;
      if (task.autopilot === undefined) { task.autopilot = false; changed = true; }
      if (task.subtasks === undefined) { task.subtasks = []; changed = true; }
      if (task.dependsOn === undefined) { task.dependsOn = []; changed = true; }
      if (task.parentTaskId === undefined) { task.parentTaskId = null; changed = true; }
      if (changed) {
        ctx.writeJSON(tp, task);
        // Sync key fields to index entry
        if (t.autopilot === undefined) { t.autopilot = false; indexChanged = true; }
        if (t.subtasks === undefined) { t.subtasks = []; indexChanged = true; }
        if (t.dependsOn === undefined) { t.dependsOn = []; indexChanged = true; }
        if (t.parentTaskId === undefined) { t.parentTaskId = null; indexChanged = true; }
      }
    });
    if (indexChanged) ctx.writeJSON(indexPath, index);
  }

  // ── Agent memory files ──
  var registry = ctx.readJSON(ctx.path.join(ctx.ROOT, 'agents/_registry.json'));
  if (registry && registry.agents) {
    registry.agents.forEach(function(a) {
      var agentDir = ctx.path.join(ctx.ROOT, 'agents', a.id);
      if (!ctx.fs.existsSync(agentDir)) return;

      var shortPath = ctx.path.join(agentDir, 'short-memory.md');
      var longPath = ctx.path.join(agentDir, 'long-memory.md');

      if (!ctx.fs.existsSync(shortPath)) {
        var shortContent = '# ' + a.name + ' - Short Memory\nLast updated: -\n\n## Active Tasks\n- None\n\n## Recent Completions (last 7 days)\n- None\n\n## Working Context\n- (empty)\n\n## Blockers\n- None\n';
        ctx.fs.writeFileSync(shortPath, shortContent);
      }
      if (!ctx.fs.existsSync(longPath)) {
        var longContent = '# ' + a.name + ' - Long Memory\n\n## Tools & Access\n- (none recorded)\n\n## Domain Knowledge\n- (none recorded)\n\n## Owner Preferences\n- (none recorded)\n\n## Completed Work Log\n- (none recorded)\n';
        ctx.fs.writeFileSync(longPath, longContent);
      }
    });
  }

  ctx.log('  Migration 2.6.0: autopilot/subtask fields and agent memory files ensured.');
};
