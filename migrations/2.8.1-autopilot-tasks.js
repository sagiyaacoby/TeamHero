// Migration: 2.8.1 - Convert autopilot schedules to tasks
// Reads config/autopilot.json, creates tasks with autopilot + interval fields,
// backs up the original file.

module.exports = function(ctx) {
  var autopilotPath = ctx.path.join(ctx.ROOT, 'config/autopilot.json');
  if (!ctx.fs.existsSync(autopilotPath)) {
    ctx.log('  Migration 2.8.1: No autopilot.json found, skipping schedule migration.');
  } else {
    var schedules = ctx.readJSON(autopilotPath);
    if (schedules && schedules.length > 0) {
      var indexPath = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
      var index = ctx.readJSON(indexPath) || { tasks: [] };
      var now = new Date().toISOString();

      schedules.forEach(function(sched) {
        // Decompose intervalMinutes into value + unit
        var interval, intervalUnit;
        var mins = sched.intervalMinutes || 60;
        if (mins >= 1440 && mins % 1440 === 0) {
          interval = mins / 1440;
          intervalUnit = 'days';
        } else if (mins >= 60 && mins % 60 === 0) {
          interval = mins / 60;
          intervalUnit = 'hours';
        } else {
          interval = mins;
          intervalUnit = 'minutes';
        }

        // Generate task ID
        var id = 'mig' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

        var taskDir = ctx.path.join(ctx.ROOT, 'data/tasks', id);
        ctx.fs.mkdirSync(ctx.path.join(taskDir, 'v1'), { recursive: true });

        var task = {
          id: id,
          title: sched.name || 'Migrated Schedule',
          description: sched.prompt || '',
          assignedTo: sched.agentId || 'orchestrator',
          status: sched.enabled ? 'planning' : 'hold',
          priority: 'medium',
          type: 'operations',
          channel: '',
          version: 1,
          tags: ['migrated-schedule'],
          brief: '',
          autopilot: true,
          parentTaskId: null,
          subtasks: [],
          dependsOn: [],
          dueDate: null,
          blocker: null,
          interval: interval,
          intervalUnit: intervalUnit,
          lastRun: sched.lastRun || null,
          nextRun: sched.nextRun || null,
          runCount: 0,
          progressLog: [{
            message: 'Migrated from autopilot schedule (original ID: ' + (sched.id || 'unknown') + ')',
            agentId: 'system',
            timestamp: now
          }],
          createdAt: sched.createdAt || now,
          updatedAt: now
        };

        ctx.writeJSON(ctx.path.join(taskDir, 'task.json'), task);
        ctx.writeJSON(ctx.path.join(taskDir, 'v1/version.json'), {
          number: 1,
          content: 'Recurring autopilot task migrated from schedule system.',
          status: 'submitted',
          decision: null,
          comments: '',
          submittedAt: now,
          decidedAt: null,
          deliverable: '',
          result: ''
        });

        index.tasks.push({
          id: id,
          title: task.title,
          status: task.status,
          assignedTo: task.assignedTo,
          priority: task.priority,
          type: task.type,
          autopilot: true,
          parentTaskId: null,
          blocker: null,
          interval: interval,
          intervalUnit: intervalUnit
        });

        ctx.log('  Migrated schedule "' + sched.name + '" -> task ' + id);
      });

      ctx.writeJSON(indexPath, index);
    }

    // Back up the file
    var backupPath = ctx.path.join(ctx.ROOT, 'config/autopilot.json.bak');
    ctx.fs.copyFileSync(autopilotPath, backupPath);
    ctx.fs.unlinkSync(autopilotPath);
    ctx.log('  Migration 2.8.1: autopilot.json backed up to autopilot.json.bak and removed.');
  }

  // Also add interval/intervalUnit fields to existing tasks that don't have them
  var indexPath2 = ctx.path.join(ctx.ROOT, 'data/tasks/_index.json');
  var index2 = ctx.readJSON(indexPath2);
  if (index2 && index2.tasks) {
    var indexChanged = false;
    index2.tasks.forEach(function(entry) {
      var tp = ctx.path.join(ctx.ROOT, 'data/tasks', entry.id, 'task.json');
      var task = ctx.readJSON(tp);
      if (!task) return;
      var changed = false;
      if (task.interval === undefined) { task.interval = null; changed = true; }
      if (task.intervalUnit === undefined) { task.intervalUnit = null; changed = true; }
      if (task.lastRun === undefined) { task.lastRun = null; changed = true; }
      if (task.nextRun === undefined) { task.nextRun = null; changed = true; }
      if (task.runCount === undefined) { task.runCount = 0; changed = true; }
      if (changed) {
        ctx.writeJSON(tp, task);
        if (entry.interval === undefined) { entry.interval = null; indexChanged = true; }
        if (entry.intervalUnit === undefined) { entry.intervalUnit = null; indexChanged = true; }
      }
    });
    if (indexChanged) ctx.writeJSON(indexPath2, index2);
  }

  ctx.log('  Migration 2.8.1: Autopilot task fields ensured on all tasks.');
};
