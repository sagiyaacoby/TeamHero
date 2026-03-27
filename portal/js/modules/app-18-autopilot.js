  // ── Autopilot ────────────────────────────────────────
  var autopilotEditId = null;

  async function loadAutopilot() {
    var container = document.getElementById('autopilot-list');
    if (!container) return;
    try {
      var tasksData = await api.get('/api/tasks');
      var agentsData = await api.get('/api/agents');
      var agentMap = {};
      (agentsData.agents || []).forEach(function(a) { agentMap[a.id] = a.name; });
      agentMap['orchestrator'] = agentMap['orchestrator'] || 'Orchestrator';

      // Filter recurring autopilot tasks (have interval)
      var recurring = (tasksData.tasks || []).filter(function(t) {
        return t.autopilot && t.interval && t.intervalUnit && t.status !== 'cancelled';
      });

      if (recurring.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:16px 0;font-size:13px">No recurring autopilot tasks yet</div>';
        return;
      }

      var html = '<table class="autopilot-table"><thead><tr><th>Name</th><th>Agent</th><th>Interval</th><th>Last Run</th><th>Next Run</th><th>Status</th><th>Controls</th></tr></thead><tbody>';
      // Need full task data for lastRun/nextRun - fetch each
      for (var i = 0; i < recurring.length; i++) {
        var entry = recurring[i];
        var task;
        try { task = await api.get('/api/tasks/' + entry.id); } catch(e) { continue; }
        var agentName = agentMap[task.assignedTo] || task.assignedTo || '-';
        var interval = formatIntervalFields(task.interval, task.intervalUnit);
        var lastRun = task.lastRun ? new Date(task.lastRun).toLocaleString() : 'Never';
        var nextRun = task.nextRun ? new Date(task.nextRun).toLocaleString() : '-';
        var isPaused = task.status === 'hold';
        var statusLabel = isPaused ? '<span style="color:var(--warning)">Paused</span>' : '<span style="color:var(--success)">' + escHtml(task.status) + '</span>';
        var toggleIcon = isPaused ? '\u25B6' : '\u23F8';
        var toggleTitle = isPaused ? 'Resume' : 'Pause';
        html += '<tr' + (isPaused ? ' class="ap-disabled"' : '') + ' style="cursor:pointer" onclick="App.openTask(\'' + task.id + '\')">' +
          '<td style="color:var(--text-primary)">' + escHtml(task.title) + '</td>' +
          '<td>' + escHtml(agentName) + '</td>' +
          '<td>' + interval + '</td>' +
          '<td>' + lastRun + '</td>' +
          '<td>' + nextRun + '</td>' +
          '<td>' + statusLabel + (task.runCount ? ' (#' + task.runCount + ')' : '') + '</td>' +
          '<td class="ap-controls" onclick="event.stopPropagation()">' +
            '<button class="btn-icon" title="' + toggleTitle + '" onclick="App.toggleAutopilot(\'' + task.id + '\',' + isPaused + ')">' + toggleIcon + '</button>' +
            '<button class="btn-icon" title="Edit interval" onclick="App.editAutopilot(\'' + task.id + '\')">&#9998;</button>' +
            '<button class="btn-icon" title="Cancel task" onclick="App.deleteAutopilot(\'' + task.id + '\')">&#10005;</button>' +
          '</td></tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch(e) {
      container.innerHTML = '<div class="empty-state" style="padding:16px 0;font-size:13px">No recurring autopilot tasks yet</div>';
    }
  }

  function escHtml(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  function formatIntervalFields(interval, unit) {
    if (!interval || !unit) return '-';
    return interval + (unit === 'minutes' ? 'm' : unit === 'hours' ? 'h' : unit === 'days' ? 'd' : unit);
  }

  // Keep old formatInterval for compatibility
  function formatInterval(mins) {
    if (mins >= 1440 && mins % 1440 === 0) return (mins / 1440) + 'd';
    if (mins >= 60 && mins % 60 === 0) return (mins / 60) + 'h';
    return mins + 'm';
  }

  async function openAutopilotForm() {
    autopilotEditId = null;
    document.getElementById('ap-name').value = '';
    document.getElementById('ap-prompt').value = '';
    document.getElementById('ap-interval').value = '1';
    setCustomSelect('ap-unit-select', 'hours', 'Hours');
    setSchedType('recurring');
    var schedAtEl = document.getElementById('ap-scheduled-at');
    if (schedAtEl) schedAtEl.value = '';
    await populateAutopilotAgents();
    document.getElementById('autopilot-form').classList.remove('hidden');
  }

  function setSchedType(type) {
    var recurBtn = document.getElementById('sched-type-recurring');
    var oneBtn = document.getElementById('sched-type-onetime');
    var intervalFields = document.getElementById('ap-interval-fields');
    var scheduledFields = document.getElementById('ap-scheduled-fields');
    if (!recurBtn || !oneBtn) return;
    if (type === 'onetime') {
      recurBtn.classList.remove('active');
      oneBtn.classList.add('active');
      if (intervalFields) intervalFields.classList.add('hidden');
      if (scheduledFields) scheduledFields.classList.remove('hidden');
    } else {
      recurBtn.classList.add('active');
      oneBtn.classList.remove('active');
      if (intervalFields) intervalFields.classList.remove('hidden');
      if (scheduledFields) scheduledFields.classList.add('hidden');
    }
  }

  function setCustomSelect(selectId, value, label) {
    var cs = document.getElementById(selectId);
    if (!cs) return;
    var hidden = document.getElementById(cs.dataset.target);
    if (hidden) hidden.value = value;
    var trigger = cs.querySelector('.custom-select-trigger');
    if (trigger) trigger.textContent = label;
    cs.querySelectorAll('.custom-select-option').forEach(function(o) {
      o.classList.toggle('selected', o.dataset.value === value);
    });
  }

  function cancelAutopilotForm() {
    autopilotEditId = null;
    document.getElementById('autopilot-form').classList.add('hidden');
  }

  async function populateAutopilotAgents() {
    var container = document.getElementById('ap-agent-options');
    var hidden = document.getElementById('ap-agent');
    if (!container) return;
    container.innerHTML = '';
    try {
      var data = await api.get('/api/agents');
      var first = true;
      (data.agents || []).forEach(function(a) {
        var div = document.createElement('div');
        div.className = 'custom-select-option' + (first ? ' selected' : '');
        div.dataset.value = a.id;
        div.textContent = a.name + (a.isOrchestrator ? ' (Orchestrator)' : '');
        container.appendChild(div);
        if (first) {
          hidden.value = a.id;
          container.closest('.custom-select').querySelector('.custom-select-trigger').textContent = div.textContent;
          first = false;
        }
      });
    } catch(e) {}
  }

  // Custom select behavior
  document.addEventListener('click', function(e) {
    var trigger = e.target.closest('.custom-select-trigger');
    if (trigger) {
      var cs = trigger.closest('.custom-select');
      // Close all others
      document.querySelectorAll('.custom-select.open').forEach(function(el) {
        if (el !== cs) el.classList.remove('open');
      });
      cs.classList.toggle('open');
      return;
    }
    var opt = e.target.closest('.custom-select-option');
    if (opt) {
      var cs = opt.closest('.custom-select');
      var val = opt.dataset.value;
      var label = opt.textContent;
      // Update hidden input
      var hiddenId = cs.dataset.target;
      if (hiddenId) document.getElementById(hiddenId).value = val;
      // Update trigger text
      cs.querySelector('.custom-select-trigger').textContent = label;
      // Update selected state
      cs.querySelectorAll('.custom-select-option').forEach(function(o) { o.classList.remove('selected'); });
      opt.classList.add('selected');
      cs.classList.remove('open');
      return;
    }
    // Close all if clicking outside
    document.querySelectorAll('.custom-select.open').forEach(function(el) { el.classList.remove('open'); });
    // Close notification dropdown if clicking outside
    var dd = document.getElementById('notif-dropdown');
    if (dd && dd.style.display !== 'none' && !e.target.closest('.notif-dropdown') && !e.target.closest('.notif-bell')) {
      dd.style.display = 'none';
    }
  });

  async function saveAutopilot() {
    var name = document.getElementById('ap-name').value.trim();
    var prompt = document.getElementById('ap-prompt').value.trim();
    var agentId = document.getElementById('ap-agent').value;

    if (!name || !prompt) { toast('Name and prompt are required', 'error'); return; }

    // Determine schedule type
    var isOnetime = document.getElementById('sched-type-onetime') && document.getElementById('sched-type-onetime').classList.contains('active');

    try {
      if (isOnetime) {
        var schedAt = document.getElementById('ap-scheduled-at').value;
        if (!schedAt) { toast('Please select a date and time', 'error'); return; }
        var dt = new Date(schedAt);
        if (isNaN(dt.getTime())) { toast('Invalid date/time', 'error'); return; }

        if (autopilotEditId) {
          await api.put('/api/tasks/' + autopilotEditId, {
            title: name, description: prompt, assignedTo: agentId,
            scheduledAt: dt.toISOString(), interval: null, intervalUnit: null
          });
          toast('Scheduled task updated');
        } else {
          await api.post('/api/tasks', {
            title: name, description: prompt, assignedTo: agentId,
            status: 'planning', autopilot: true,
            scheduledAt: dt.toISOString()
          });
          toast('Scheduled task created');
        }
      } else {
        var intervalNum = parseInt(document.getElementById('ap-interval').value) || 1;
        var unit = document.getElementById('ap-interval-unit').value;

        if (autopilotEditId) {
          await api.put('/api/tasks/' + autopilotEditId, {
            title: name, description: prompt, assignedTo: agentId,
            interval: intervalNum, intervalUnit: unit, scheduledAt: null
          });
          toast('Recurring task updated');
        } else {
          await api.post('/api/tasks', {
            title: name, description: prompt, assignedTo: agentId,
            status: 'planning', autopilot: true,
            interval: intervalNum, intervalUnit: unit
          });
          toast('Recurring task created');
        }
      }
      cancelAutopilotForm();
      loadAutopilotPage();
    } catch(e) { toast('Failed to save: ' + (e.message || 'Unknown error'), 'error'); }
  }

  async function toggleAutopilot(id, isPaused) {
    try {
      if (isPaused) {
        // Resume: set back to closed so scheduler can pick it up on next interval
        await api.put('/api/tasks/' + id, { status: 'closed' });
        toast('Recurring task resumed');
      } else {
        // Pause: set to hold
        await api.put('/api/tasks/' + id, { status: 'hold' });
        toast('Recurring task paused');
      }
      loadAutopilotPage();
    } catch(e) { toast('Failed to update task', 'error'); }
  }

  async function editAutopilot(id) {
    try {
      var task = await api.get('/api/tasks/' + id);
      if (!task) return;
      autopilotEditId = id;
      await populateAutopilotAgents();
      document.getElementById('ap-name').value = task.title || '';
      document.getElementById('ap-prompt').value = task.description || '';
      // Set agent custom select
      var agentOpt = document.querySelector('#ap-agent-options .custom-select-option[data-value="' + task.assignedTo + '"]');
      if (agentOpt) setCustomSelect('ap-agent-select', task.assignedTo, agentOpt.textContent);
      // Set interval fields
      document.getElementById('ap-interval').value = task.interval || 1;
      var unitLabel = task.intervalUnit === 'minutes' ? 'Minutes' : task.intervalUnit === 'hours' ? 'Hours' : task.intervalUnit === 'days' ? 'Days' : 'Hours';
      setCustomSelect('ap-unit-select', task.intervalUnit || 'hours', unitLabel);
      document.getElementById('autopilot-form').classList.remove('hidden');
    } catch(e) { toast('Failed to load task', 'error'); }
  }

  async function deleteAutopilot(id) {
    var ok = await confirmAction({
      title: 'Cancel Recurring Task',
      message: 'Are you sure you want to cancel this recurring autopilot task?',
      confirmLabel: 'Cancel Task'
    });
    if (!ok) return;
    try {
      await api.put('/api/tasks/' + id, { status: 'cancelled' });
      toast('Recurring task cancelled');
      loadAutopilotPage();
    } catch(e) { toast('Failed to cancel task', 'error'); }
  }

  async function pauseSchedule(id) {
    try {
      await api.put('/api/tasks/' + id, { status: 'hold' });
      toast('Schedule paused');
      if (state.currentTaskId === id) openTask(id);
      loadAutopilotPage();
    } catch(e) { toast('Failed to pause schedule', 'error'); }
  }

  async function resumeSchedule(id) {
    try {
      await api.put('/api/tasks/' + id, { status: 'planning' });
      toast('Schedule resumed');
      if (state.currentTaskId === id) openTask(id);
      loadAutopilotPage();
    } catch(e) { toast('Failed to resume schedule', 'error'); }
  }

  async function removeSchedule(id) {
    var ok = await confirmAction({
      title: 'Remove Schedule',
      message: 'This will remove the schedule but keep the task as a regular autopilot task.',
      confirmLabel: 'Remove Schedule'
    });
    if (!ok) return;
    try {
      await api.put('/api/tasks/' + id, { interval: null, intervalUnit: null, nextRun: null, scheduledAt: null });
      toast('Schedule removed');
      if (state.currentTaskId === id) openTask(id);
      loadAutopilotPage();
    } catch(e) { toast('Failed to remove schedule', 'error'); }
  }

  async function editScheduledAt(id) {
    var current = '';
    try {
      var task = await api.get('/api/tasks/' + id);
      if (task && task.scheduledAt) {
        var d = new Date(task.scheduledAt);
        current = d.toISOString().slice(0, 16);
      }
    } catch(e) {}
    var newVal = prompt('Enter new scheduled date/time (YYYY-MM-DDTHH:MM):', current);
    if (!newVal) return;
    try {
      var dt = new Date(newVal);
      if (isNaN(dt.getTime())) { toast('Invalid date/time', 'error'); return; }
      await api.put('/api/tasks/' + id, { scheduledAt: dt.toISOString() });
      toast('Scheduled time updated');
      if (state.currentTaskId === id) openTask(id);
      loadAutopilotPage();
    } catch(e) { toast('Failed to update scheduled time', 'error'); }
  }

  async function loadAutopilotPage() {
    loadAutopilot();
    loadAutopilotTasks();
    updateAutopilotBadge();
  }

  async function loadAutopilotTasks() {
    var container = document.getElementById('autopilot-tasks');
    if (!container) return;
    try {
      var tasksData = await api.get('/api/tasks');
      var allTasks = tasksData.tasks || [];

      // One-time scheduled tasks: have scheduledAt, no interval, not closed/cancelled/done
      var scheduled = allTasks.filter(function(t) {
        return t.scheduledAt && !t.interval && t.status !== 'closed' && t.status !== 'cancelled' && t.status !== 'done';
      });

      // Autopilot tasks (no schedule): autopilot=true, no interval, no scheduledAt, not closed/done/cancelled
      var autopilotOnly = allTasks.filter(function(t) {
        return t.autopilot && !t.interval && !t.scheduledAt && t.status !== 'closed' && t.status !== 'done' && t.status !== 'cancelled';
      });

      var html = '';

      // Section 1: One-time scheduled tasks
      html += '<h3 style="margin-top:0;margin-bottom:8px;font-size:14px;color:var(--text-muted)">One-Time Scheduled Tasks</h3>';
      if (scheduled.length === 0) {
        html += '<div class="empty-state" style="padding:12px 0;font-size:13px">No one-time scheduled tasks</div>';
      } else {
        scheduled.forEach(function(t) {
          html += renderTaskCard(t, 'dashboard', false, 0);
        });
      }

      // Section 2: Autopilot tasks (no schedule)
      html += '<h3 style="margin-top:20px;margin-bottom:8px;font-size:14px;color:var(--text-muted)">Autopilot Tasks (No Schedule)</h3>';
      if (autopilotOnly.length === 0) {
        html += '<div class="empty-state" style="padding:12px 0;font-size:13px">No active autopilot tasks without a schedule</div>';
      } else {
        autopilotOnly.forEach(function(t) {
          html += renderTaskCard(t, 'dashboard', false, 0);
        });
      }

      container.innerHTML = html;
    } catch(e) { console.error('Failed to load autopilot tasks:', e); }
  }

  async function updateAutopilotBadge() {
    try {
      var tasksData = state.tasks && state.tasks.length > 0 ? { tasks: state.tasks } : await api.get('/api/tasks');
      var apTasks = (tasksData.tasks || []).filter(function(t) {
        return t.autopilot && t.status !== 'closed' && t.status !== 'done' && t.status !== 'cancelled';
      });
      var badge = document.getElementById('nav-autopilot-badge');
      if (badge) {
        badge.textContent = apTasks.length;
        badge.classList.toggle('hidden', apTasks.length === 0);
      }
    } catch(e) {}
  }

  async function pauseAllAutopilot() {
    try {
      var tasksData = await api.get('/api/tasks');
      var recurring = (tasksData.tasks || []).filter(function(t) {
        return t.autopilot && t.interval && t.intervalUnit && t.status !== 'cancelled' && t.status !== 'hold';
      });
      await Promise.all(recurring.map(function(t) {
        return api.put('/api/tasks/' + t.id, { status: 'hold' });
      }));
      toast('All recurring tasks paused');
      loadAutopilotPage();
    } catch(e) { toast('Failed to pause tasks', 'error'); }
  }

  async function resumeAllAutopilot() {
    try {
      var tasksData = await api.get('/api/tasks');
      var paused = (tasksData.tasks || []).filter(function(t) {
        return t.autopilot && t.interval && t.intervalUnit && t.status === 'hold';
      });
      await Promise.all(paused.map(function(t) {
        return api.put('/api/tasks/' + t.id, { status: 'closed' });
      }));
      toast('All recurring tasks resumed');
      loadAutopilotPage();
    } catch(e) { toast('Failed to resume tasks', 'error'); }
  }

