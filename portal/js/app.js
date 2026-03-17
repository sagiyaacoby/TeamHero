(function() {
  'use strict';

  // ── State ──────────────────────────────────────────
  let state = {
    currentView: 'dashboard',
    currentAgentId: null,
    editingAgentId: null,
    wizardStep: 1,
    agents: [],
    tasks: [],
    templates: [],
    previousView: null,
    previousAgentId: null,
    currentTaskId: null,
    mediaFilter: 'all',
    dashboardTaskFilter: 'all',
    agentTaskFilter: 'all',
    cachedDashboardTasks: [],
    cachedAgentTasks: [],
  };

  var PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
  var q = String.fromCharCode(39);

  // ── API Client ─────────────────────────────────────
  const api = {
    async get(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    },
    async put(url, data) {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    },
    async post(url, data) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      var body = await res.json();
      if (!res.ok) {
        var err = new Error(body.error || 'API error: ' + res.status);
        err.body = body;
        throw err;
      }
      return body;
    },
    async del(url) {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    },
  };

  // ── Toast ──────────────────────────────────────────
  function toast(msg, type) {
    type = type || 'success';
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + type;
    clearTimeout(el._timer);
    el._timer = setTimeout(function() { el.className = 'toast hidden'; }, 3000);
  }

  // ── Confirmation Modal ─────────────────────────────
  function confirmAction(opts) {
    // opts: { title, message, confirmLabel, requireText, onConfirm }
    return new Promise(function(resolve) {
      var overlay = document.getElementById('confirm-modal');
      var titleEl = document.getElementById('confirm-title');
      var msgEl = document.getElementById('confirm-message');
      var inputWrap = document.getElementById('confirm-input-wrap');
      var inputEl = document.getElementById('confirm-input');
      var hintEl = document.getElementById('confirm-hint');
      var okBtn = document.getElementById('confirm-ok-btn');
      var cancelBtn = document.getElementById('confirm-cancel-btn');

      titleEl.textContent = opts.title || 'Are you sure?';
      msgEl.textContent = opts.message || '';
      okBtn.textContent = opts.confirmLabel || 'Delete';

      if (opts.requireText) {
        inputWrap.classList.remove('hidden');
        inputEl.value = '';
        hintEl.textContent = 'Type "' + opts.requireText + '" to confirm';
        okBtn.disabled = true;
      } else {
        inputWrap.classList.add('hidden');
        inputEl.value = '';
        okBtn.disabled = false;
      }

      overlay.classList.remove('hidden');
      if (opts.requireText) inputEl.focus();

      function onInput() {
        okBtn.disabled = inputEl.value.trim().toLowerCase() !== opts.requireText.toLowerCase();
      }
      function cleanup() {
        overlay.classList.add('hidden');
        inputEl.removeEventListener('input', onInput);
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function onKey(e) {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && !okBtn.disabled) onOk();
      }

      if (opts.requireText) inputEl.addEventListener('input', onInput);
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  }

  // ── Navigation ─────────────────────────────────────
  function navigate(viewId, agentId) {
    state.currentView = viewId;
    document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-link').forEach(function(l) { l.classList.remove('active'); });

    if (viewId === 'agent-detail' && agentId) {
      state.currentAgentId = agentId;
      document.getElementById('view-agent-detail').classList.add('active');
      loadAgentDetail(agentId);
      var navEl = document.querySelector('[data-agent-id="' + agentId + '"]');
      if (navEl) navEl.classList.add('active');
    } else if (viewId === 'task-detail') {
      document.getElementById('view-task-detail').classList.add('active');
    } else if (viewId === 'knowledge-detail') {
      document.getElementById('view-knowledge-detail').classList.add('active');
    } else if (viewId === 'add-agent') {
      state.editingAgentId = null;
      document.getElementById('view-add-agent').classList.add('active');
      document.getElementById('agent-form-title').textContent = 'Add New Agent';
      document.getElementById('af-submit').textContent = 'Create Agent';
      clearAgentForm();
      loadTemplatesForPicker('page-template-picker');
      var navEl = document.querySelector('[data-view="add-agent"]');
      if (navEl) navEl.classList.add('active');
    } else if (viewId === 'chat') {
      document.getElementById('view-chat').classList.add('active');
      var navEl = document.querySelector('[data-view="chat"]');
      if (navEl) navEl.classList.add('active');
      setTimeout(function() {
        initTerminal();
        if (fitAddon) try { fitAddon.fit(); } catch(e) {}
        if (terminal) terminal.focus();
      }, 50);
    } else {
      var el = document.getElementById('view-' + viewId);
      if (el) el.classList.add('active');
      var navEl = document.querySelector('[data-view="' + viewId + '"]');
      if (navEl) navEl.classList.add('active');

      if (viewId === 'dashboard') loadDashboard();
      if (viewId === 'profile') loadProfileEditor();
      if (viewId === 'rules') loadRulesEditor();
      if (viewId === 'settings') loadSettings();
      if (viewId === 'media') loadMedia();
      if (viewId === 'skills') loadSkills();
      if (viewId === 'knowledge') loadKnowledge();
      if (viewId === 'help') loadHelp(0);
    }
  }

  document.addEventListener('click', function(e) {
    var link = e.target.closest('.nav-link');
    if (!link) return;
    e.preventDefault();
    var view = link.dataset.view;
    var agentId = link.dataset.agentId;
    if (agentId) {
      navigate('agent-detail', agentId);
    } else if (view) {
      navigate(view);
    }
  });

  // ── Global WebSocket ───────────────────────────────
  var globalWs = null;
  var wsReconnectTimer = null;

  // ── Terminal State ──────────────────────────────────
  var terminal = null;
  var fitAddon = null;
  var termWs = null;
  var termSessionId = null;
  var termInitialized = false;
  var termWsReconnectTimer = null;
  var termSessionEnded = false;

  function connectWebSocket() {
    if (globalWs && globalWs.readyState <= 1) return;

    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.host + '/ws';
    globalWs = new WebSocket(wsUrl);

    globalWs.onopen = function() {
      clearTimeout(wsReconnectTimer);
    };

    globalWs.onmessage = function(evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'refresh') {
          handleRefresh(data.scope);
        }
      } catch(e) {
        console.error('WS parse error:', e);
      }
    };

    globalWs.onclose = function(evt) {
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    globalWs.onerror = function(evt) {
    };
  }

  // ── Live Refresh Handler (debounced) ────────────────
  var refreshTimer = null;
  var pendingRefreshScope = null;

  function handleRefresh(scope) {
    // Merge scopes — 'all' wins, otherwise accumulate
    if (pendingRefreshScope === 'all' || scope === 'all') {
      pendingRefreshScope = 'all';
    } else if (!pendingRefreshScope) {
      pendingRefreshScope = scope;
    }
    // Debounce: wait 3 seconds before actually refreshing
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function() {
      doRefresh(pendingRefreshScope || 'all');
      pendingRefreshScope = null;
      refreshTimer = null;
    }, 3000);
  }

  function doRefresh(scope) {
    // Skip refresh if user is on the Command Center — don't disrupt terminal
    if (state.currentView === 'chat') {
      loadSidebarAgents();
      return;
    }
    loadSidebarAgents();
    var v = state.currentView;
    if (scope === 'all' || scope === 'agents' || scope === 'tasks') {
      if (v === 'dashboard') loadDashboard();
    }
    if (scope === 'all' || scope === 'agents') {
      if (v === 'agent-detail' && state.currentAgentId) loadAgentDetail(state.currentAgentId);
      if (v === 'settings') loadSettings();
    }
    if (scope === 'all' || scope === 'profile') {
      if (v === 'profile') loadProfileEditor();
    }
    if (scope === 'all' || scope === 'rules') {
      if (v === 'rules') loadRulesEditor();
    }
    if (scope === 'all' || scope === 'secrets') {
      if (v === 'settings') loadSecretsStatus();
    }
    if (scope === 'all' || scope === 'skills') {
      if (v === 'skills') loadSkills();
    }
    if (scope === 'all' || scope === 'knowledge') {
      if (v === 'knowledge') loadKnowledge();
    }
    if (scope === 'all' || scope === 'autopilot') {
      if (v === 'settings') loadAutopilot();
    }
  }

  // ── Sidebar Agents ─────────────────────────────────
  async function loadSidebarAgents() {
    try {
      const [agentsData, tasksData] = await Promise.all([
        api.get('/api/agents'),
        api.get('/api/tasks'),
      ]);
      state.agents = agentsData.agents || [];
      state.tasks = tasksData.tasks || [];
      renderSidebarAgents();
    } catch(e) { console.error('Failed to load agents:', e); }
  }

  function renderSidebarAgents() {
    const container = document.getElementById('nav-agents-list');
    if (!container) return;
    if (state.agents.length === 0) {
      container.innerHTML = '<span class="nav-link" style="font-style:italic;font-size:12px;pointer-events:none">No agents yet</span>';
      return;
    }

    var orchAgents = state.agents.filter(function(a) { return a.isOrchestrator; });
    var subAgents = state.agents.filter(function(a) { return !a.isOrchestrator; });

    // Build set of agents with in_progress tasks
    var workingAgents = {};
    (state.tasks || []).forEach(function(t) {
      if (t.status === 'in_progress' && t.assignedTo) workingAgents[t.assignedTo] = true;
    });

    var html = '';

    orchAgents.forEach(function(a) {
      var isActive = state.currentView === 'agent-detail' && state.currentAgentId === a.id;
      var dotClass = 'agent-dot' + (workingAgents[a.id] ? ' agent-dot-working' : '');
      var dotTitle = workingAgents[a.id] ? 'Working on task' : 'Idle';
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link nav-orchestrator' + (isActive ? ' active' : '') + '">' +
        '<span class="icon">&#9733;</span> ' + escHtml(a.name) + '<span class="' + dotClass + '" title="' + dotTitle + '"></span></a>';
    });

    subAgents.forEach(function(a) {
      var isActive = state.currentView === 'agent-detail' && state.currentAgentId === a.id;
      var dotClass = 'agent-dot' + (workingAgents[a.id] ? ' agent-dot-working' : '');
      var dotTitle = workingAgents[a.id] ? 'Working on task' : 'Idle';
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link' + (isActive ? ' active' : '') + '">' +
        '<span class="icon">&#9670;</span> ' + escHtml(a.name) + '<span class="' + dotClass + '" title="' + dotTitle + '"></span></a>';
    });

    container.innerHTML = html;

    // Hide "Add Agent" link until orchestrator exists
    var addAgentLink = document.querySelector('[data-view="add-agent"]');
    if (addAgentLink) {
      addAgentLink.closest('li').style.display = orchAgents.length > 0 ? '' : 'none';
    }
  }

  // ── Dashboard ──────────────────────────────────────
  async function loadDashboard() {
    try {
      const [agentsData, tasksData] = await Promise.all([
        api.get('/api/agents'),
        api.get('/api/tasks'),
      ]);
      state.agents = agentsData.agents || [];
      state.tasks = tasksData.tasks || [];
      renderSidebarAgents();

      document.getElementById('stat-agents').textContent = state.agents.length;
      var pending = 0, approved = 0, active = 0, done = 0, hold = 0;
      state.tasks.forEach(function(t) {
        if (t.status === 'pending_approval') pending++;
        else if (t.status === 'approved') approved++;
        else if (t.status === 'in_progress' || t.status === 'draft' || t.status === 'revision_needed') active++;
        else if (t.status === 'done') done++;
        else if (t.status === 'hold') hold++;
      });
      document.getElementById('stat-total').textContent = state.tasks.length;
      document.getElementById('stat-pending').textContent = pending;
      document.getElementById('stat-approved').textContent = approved;
      document.getElementById('stat-active-tasks').textContent = active;
      document.getElementById('stat-done').textContent = done;
      // Highlight active filter stat card
      document.querySelectorAll('.stat-card[data-filter]').forEach(function(card) {
        card.classList.toggle('stat-card-active', card.dataset.filter === state.dashboardTaskFilter);
      });

      // Fetch full task details for priority sorting
      var fullTasks = await Promise.all(state.tasks.map(function(t) {
        return api.get('/api/tasks/' + t.id).catch(function() { return Object.assign({priority:'medium'}, t); });
      }));

      var statusOrder = { pending_approval: 0, in_progress: 1, draft: 2, approved: 3, revision_needed: 4, hold: 5, done: 6 };
      fullTasks.sort(function(a, b) {
        var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9;
        var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9;
        if (sa !== sb) return sa - sb;
        var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 2;
        var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 2;
        if (pa !== pb) return pa - pb;
        return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
      });

      state.cachedDashboardTasks = fullTasks;
      renderFilteredTasks('dashboard');

      loadRoundTable();
    } catch(e) { console.error('Dashboard load error:', e); }
  }

  async function loadRoundTable() {
    try {
      const files = await api.get('/api/ls/data/round-tables');
      const mdFiles = files.filter(function(f) { return !f.isDir && f.name.endsWith('.md'); })
        .sort(function(a, b) { return b.name.localeCompare(a.name); });
      const el = document.getElementById('last-round-table');
      if (mdFiles.length === 0) {
        el.innerHTML = '<div class="empty-state">No round tables yet</div>';
        return;
      }
      const data = await api.get('/api/file/data/round-tables/' + encodeURIComponent(mdFiles[0].name));
      el.innerHTML = '<div class="round-table-content">' + renderMarkdown(data.content || 'Empty') + '</div>';
    } catch(e) {
      document.getElementById('last-round-table').innerHTML = '<div class="empty-state">No round tables yet</div>';
    }
  }

  // ── Agent Detail ───────────────────────────────────
  async function loadAgentDetail(id) {
    try {
      const agent = await api.get('/api/agents/' + id);
      const [shortMem, longMem] = await Promise.all([
        api.get('/api/agents/' + id + '/memory/short'),
        api.get('/api/agents/' + id + '/memory/long'),
      ]);

      document.getElementById('agent-detail-title').textContent = agent.name;
      document.getElementById('agent-detail-status').textContent = agent.status || 'active';
      document.getElementById('agent-detail-role').textContent = agent.role;
      document.getElementById('agent-detail-mission').textContent = agent.mission || 'No mission defined.';
      document.getElementById('agent-detail-desc').textContent = agent.description || 'No description.';

      var p = agent.personality || {};
      document.getElementById('agent-detail-traits').textContent = (p.traits || []).join(', ') || 'Not specified';
      document.getElementById('agent-detail-tone').textContent = p.tone || 'Not specified';
      document.getElementById('agent-detail-style').textContent = p.style || 'Not specified';

      var rulesEl = document.getElementById('agent-detail-rules');
      rulesEl.innerHTML = (agent.rules || []).map(function(r) { return '<li>' + escHtml(r) + '</li>'; }).join('') || '<li>No specific rules.</li>';

      document.getElementById('agent-detail-caps').textContent = (agent.capabilities || []).join(', ') || 'No capabilities defined.';
      document.getElementById('agent-detail-short-mem').textContent = shortMem.content || 'Empty';
      document.getElementById('agent-detail-long-mem').textContent = longMem.content || 'Empty';

      var deleteBtn = document.getElementById('agent-delete-btn');
      if (deleteBtn) {
        deleteBtn.style.display = agent.isOrchestrator ? 'none' : '';
      }

      // Fetch tasks assigned to this agent
      try {
        var tasksData = await api.get('/api/tasks');
        var agentTasks = (tasksData.tasks || []).filter(function(t) { return t.assignedTo === id; });
        var fullAgentTasks = await Promise.all(agentTasks.map(function(t) {
          return api.get('/api/tasks/' + t.id).catch(function() { return Object.assign({ priority: 'medium' }, t); });
        }));
        renderAgentTasks(fullAgentTasks);
      } catch(te) {
        console.error('Failed to load agent tasks:', te);
      }
    } catch(e) {
      console.error('Failed to load agent:', e);
      toast('Failed to load agent', 'error');
    }
  }


  // ── Agent Tasks ───────────────────────────────
  function renderAgentTasks(tasks) {
    var summaryEl = document.getElementById('agent-tasks-summary');
    if (!summaryEl) return;

    var pending = 0, approved = 0, active = 0, done = 0;
    tasks.forEach(function(t) {
      if (t.status === 'pending_approval') pending++;
      else if (t.status === 'approved') approved++;
      else if (t.status === 'in_progress' || t.status === 'draft' || t.status === 'revision_needed') active++;
      else if (t.status === 'done') done++;
    });
    var af = state.agentTaskFilter;
    var total = tasks.length;
    summaryEl.innerHTML =
      '<span class="badge badge-all clickable-badge' + (af === 'all' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'all\',\'agent\')">' + total + ' All</span> ' +
      '<span class="badge badge-pending_approval clickable-badge' + (af === 'pending_approval' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'pending_approval\',\'agent\')">' + pending + ' Pending</span> ' +
      '<span class="badge badge-approved clickable-badge' + (af === 'approved' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'approved\',\'agent\')">' + approved + ' Approved</span> ' +
      '<span class="badge badge-in_progress clickable-badge' + (af === 'in_progress' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'in_progress\',\'agent\')">' + active + ' In Progress</span> ' +
      '<span class="badge badge-done clickable-badge' + (af === 'done' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'done\',\'agent\')">' + done + ' Done</span>';

    state.cachedAgentTasks = tasks;
    renderFilteredTasks('agent');
  }

  function renderFilteredTasks(context) {
    var filter = context === 'dashboard' ? state.dashboardTaskFilter : state.agentTaskFilter;
    var tasks = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;
    var listEl = document.getElementById(context === 'dashboard' ? 'dashboard-tasks' : 'agent-tasks-list');
    if (!listEl) return;

    // Filter tasks
    var filtered;
    if (filter === 'all') {
      filtered = tasks.slice();
    } else if (filter === 'in_progress') {
      filtered = tasks.filter(function(t) { return t.status === 'in_progress' || t.status === 'draft' || t.status === 'revision_needed'; });
    } else {
      filtered = tasks.filter(function(t) { return t.status === filter; });
    }

    // Sort
    var statusOrder = { pending_approval: 0, approved: 1, in_progress: 2, draft: 3, revision_needed: 4, done: 5 };
    filtered.sort(function(a, b) {
      var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9;
      var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9;
      if (sa !== sb) return sa - sb;
      var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 2;
      var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 2;
      return pa - pb;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No ' + (filter === 'all' ? '' : filter.replace(/_/g, ' ') + ' ') + 'tasks</div>';
      return;
    }

    listEl.innerHTML = filtered.map(function(t) {
      var statusClass = 'badge-' + (t.status || 'draft');
      var priorityClass = 'badge-' + (t.priority || 'medium');
      var agentName = '';
      if (context === 'dashboard' && t.assignedTo) {
        var found = state.agents.find(function(a) { return a.id === t.assignedTo; });
        agentName = found ? found.name : t.assignedTo;
      }
      // Output indicator — check if task has deliverable content or knowledge doc
      var hasOutput = t.knowledgeDocId || t.hasDeliverable;
      var outputIcon = hasOutput ? '<span class="task-output-icon" title="Has output">&#128196;</span>' : '';

      var isWorking = t.status === 'in_progress';
      var workingDot = isWorking ? '<span class="agent-working-dot" title="In progress"></span>' : '';

      return '<div class="task-item" onclick="App.openTask(' + q + t.id + q + ')">' +
        '<span class="task-title">' + outputIcon + escHtml(t.title) + '</span>' +
        '<span class="task-meta">' +
          '<span class="badge ' + priorityClass + '">' + escHtml(t.priority || 'medium') + '</span>' +
          '<span class="badge ' + statusClass + '">' + escHtml((t.status || 'draft').replace(/_/g, ' ')) + workingDot + '</span>' +
          (agentName ? '<span>' + escHtml(agentName) + '</span>' : '') +
        '</span></div>';
    }).join('');
  }

  function filterTasks(filter, context) {
    if (context === 'dashboard') {
      state.dashboardTaskFilter = filter;
      // Update stat card highlights
      document.querySelectorAll('.stat-card[data-filter]').forEach(function(card) {
        card.classList.toggle('stat-card-active', card.dataset.filter === filter);
      });
      // Update panel title
      var titleEl = document.getElementById('dashboard-tasks-title');
      if (titleEl) {
        var labels = { all: 'All Tasks', pending_approval: 'Pending Approval', approved: 'Approved', revision_needed: 'Improve', in_progress: 'In Progress', done: 'Done' };
        titleEl.textContent = labels[filter] || filter.replace(/_/g, ' ');
      }
    } else {
      state.agentTaskFilter = filter;
      // Re-render agent summary badges to update highlight
      var summaryEl = document.getElementById('agent-tasks-summary');
      if (summaryEl) {
        summaryEl.querySelectorAll('.clickable-badge').forEach(function(badge) {
          var badgeFilter = badge.getAttribute('onclick').match(/'([^']+)'/);
          if (badgeFilter) badge.classList.toggle('badge-active-filter', badgeFilter[1] === filter);
        });
      }
    }
    renderFilteredTasks(context);
  }

  // ── Add Task Modal ────────────────────────────
  function openAddTask(preselectedAgent) {
    var modal = document.getElementById('add-task-modal');
    var agentSelect = document.getElementById('add-task-agent');
    // Populate agent dropdown
    agentSelect.innerHTML = '<option value="">Auto (orchestrator decides)</option>';
    state.agents.forEach(function(a) {
      if (a.isOrchestrator) return;
      var opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + ' — ' + a.role;
      agentSelect.appendChild(opt);
    });
    if (preselectedAgent) agentSelect.value = preselectedAgent;
    // Reset fields
    document.getElementById('add-task-title').value = '';
    document.getElementById('add-task-desc').value = '';
    document.getElementById('add-task-priority').value = 'medium';
    document.getElementById('add-task-type').value = 'general';
    modal.classList.remove('hidden');
    setTimeout(function() { document.getElementById('add-task-title').focus(); }, 100);
  }

  function closeAddTask() {
    document.getElementById('add-task-modal').classList.add('hidden');
  }

  async function submitAddTask() {
    var title = document.getElementById('add-task-title').value.trim();
    if (!title) { toast('Please enter a task title', 'error'); return; }
    var desc = document.getElementById('add-task-desc').value.trim();
    var agent = document.getElementById('add-task-agent').value;
    var priority = document.getElementById('add-task-priority').value;
    var type = document.getElementById('add-task-type').value;

    try {
      await api.post('/api/tasks', {
        title: title,
        description: desc || title,
        assignedTo: agent || 'orchestrator',
        status: 'draft',
        priority: priority,
        type: type
      });
      closeAddTask();
      toast('Task created! The orchestrator will refine it.', 'success');
    } catch(e) {
      toast('Failed to create task: ' + e.message, 'error');
    }
  }

  function switchAgentTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.agent-tab').forEach(function(div) {
      div.classList.toggle('active', div.id === 'agent-tab-' + tab);
    });
  }

  // ── Task Detail ─────────────────────────────────
  async function openTask(id) {
    state.currentTaskId = id;
    state.previousView = state.currentView;
    state.previousAgentId = state.currentAgentId;

    try {
      var task = await api.get('/api/tasks/' + id);

      document.getElementById('task-detail-title').textContent = task.title || 'Untitled';

      var statusEl = document.getElementById('task-detail-status');
      if (task.status === 'approved') {
        statusEl.innerHTML = 'Executing <span class="agent-working-dot"></span>';
      } else {
        statusEl.textContent = (task.status || 'draft').replace(/_/g, ' ');
      }
      statusEl.className = 'badge badge-' + (task.status || 'draft');

      var priorityEl = document.getElementById('task-detail-priority');
      priorityEl.textContent = task.priority || 'medium';
      priorityEl.className = 'badge badge-' + (task.priority || 'medium');

      var agentName = task.assignedTo || 'Unassigned';
      if (task.assignedTo && state.agents.length > 0) {
        var found = state.agents.find(function(a) { return a.id === task.assignedTo; });
        if (found) agentName = found.name;
      }
      document.getElementById('task-detail-agent').textContent = agentName;
      document.getElementById('task-detail-date').textContent = task.updatedAt ? new Date(task.updatedAt).toLocaleDateString() : '-';

      var tagsEl = document.getElementById('task-detail-tags');
      if (task.tags && task.tags.length > 0) {
        tagsEl.innerHTML = task.tags.map(function(tag) { return '<span class="tag-badge">' + escHtml(tag) + '</span>'; }).join('');
      } else {
        tagsEl.innerHTML = '';
      }

      var typeEl = document.getElementById('task-detail-type');
      if (task.type && task.type !== 'general') {
        typeEl.textContent = task.type;
        typeEl.className = 'badge badge-type badge-type-' + task.type;
        typeEl.style.display = '';
      } else {
        typeEl.style.display = 'none';
      }

      // Promote to Knowledge bar
      var promoteBar = document.getElementById('task-promote-bar');
      var knowledgeLink = document.getElementById('task-knowledge-link');
      if (task.knowledgeDocId) {
        promoteBar.classList.add('hidden');
        knowledgeLink.innerHTML = '&#128218; <a onclick="App.openKnowledgeDoc(\'' + task.knowledgeDocId + '\')">View in Knowledge Base</a>';
        knowledgeLink.classList.remove('hidden');
      } else if (task.status === 'approved' || task.status === 'done') {
        promoteBar.classList.remove('hidden');
        knowledgeLink.classList.add('hidden');
      } else {
        promoteBar.classList.add('hidden');
        knowledgeLink.classList.add('hidden');
      }

      await renderTaskSession(id, task, agentName);
      navigate('task-detail');
    } catch(e) {
      console.error('Failed to load task:', e);
      toast('Failed to load task', 'error');
    }
  }

  function renderMarkdown(text) {
    try {
      return (typeof marked !== 'undefined' && marked.parse) ? marked.parse(text) : escHtml(text).replace(/\n/g, '<br>');
    } catch(e) {
      return escHtml(text).replace(/\n/g, '<br>');
    }
  }

  async function renderTaskSession(taskId, task, agentName) {
    var container = document.getElementById('task-session');
    var html = '';

    // ── Owner Instructions ──
    html += '<div class="session-instructions">';
    html += '<div class="session-section-label">Owner Instructions</div>';
    if (task.description) {
      html += '<div class="session-brief-content">' + renderMarkdown(task.description) + '</div>';
    }
    if (task.brief) {
      html += '<div class="session-brief-content">' + renderMarkdown(task.brief) + '</div>';
    }
    html += '</div>';

    // ── Versions ──
    var versions = [];
    try {
      versions = await api.get('/api/tasks/' + taskId + '/versions');
      if (!versions) versions = [];
    } catch(e) { versions = []; }

    if (versions.length === 0 && task.status === 'draft') {
      html += '<div class="session-awaiting">Awaiting agent submission...</div>';
    }

    if (versions.length > 0) {
      versions.forEach(function(v, idx) {
        var isLatest = idx === versions.length - 1;
        var isApproved = v.decision === 'approve' || v.decision === 'approved';
        var isImproved = v.decision === 'improve';

        // Version header
        html += '<div class="session-version' + (isLatest ? ' latest' : '') + '">';
        html += '<div class="session-version-header">';
        html += '<div class="session-version-id">';
        html += '<span class="session-dot' + (isApproved ? ' dot-approved' : isImproved ? ' dot-improved' : '') + '"></span>';
        html += 'v' + v.number;
        if (v.submittedAt) html += ' &mdash; ' + new Date(v.submittedAt).toLocaleDateString();
        else if (v.decidedAt) html += ' &mdash; ' + new Date(v.decidedAt).toLocaleDateString();
        html += '</div>';
        html += '<span class="session-agent-name">Agent: ' + escHtml(agentName) + '</span>';
        html += '</div>';

        // Version content
        if (v.content) {
          html += '<div class="session-content">' + renderMarkdown(v.content) + '</div>';
        } else {
          html += '<div class="session-content"><span class="empty-state" style="padding:8px">Awaiting submission...</span></div>';
        }

        // Deliverable
        if (v.deliverable) {
          html += '<div class="version-deliverable"><div class="version-deliverable-label">Deliverable</div>' + linkifyText(escHtml(v.deliverable)).replace(/\n/g, '<br>') + '</div>';
        }
        // Result
        if (v.result) {
          html += '<div class="version-result"><div class="version-result-label">Result</div>' + linkifyText(escHtml(v.result)).replace(/\n/g, '<br>') + '</div>';
        }
        // Files
        if (v.files && v.files.length > 0) {
          html += '<div class="version-files"><div class="version-files-label">Attachments</div>' +
            v.files.map(function(f) {
              return '<a href="#" class="version-file-link" data-task="' + taskId + '" data-version="' + v.number + '" data-file="' + escHtml(f) + '" onclick="App.viewVersionFile(this);return false;">' + escHtml(f) + '</a>';
            }).join('') + '</div>';
        }

        // Owner feedback (shown after version if decision/comments were given)
        if (v.decision || v.comments) {
          var fbClass = v.decision === 'improve' ? 'session-feedback-improve' : v.decision === 'approved' ? 'session-feedback-approved' : v.decision === 'done' ? 'session-feedback-done' : '';
          html += '<div class="session-feedback ' + fbClass + '">';
          html += '<div class="session-feedback-label">Owner Feedback';
          if (v.decision) {
            var decisionLabels = { approved: 'Approve & Execute', improve: 'Improve', done: 'Done', hold: 'Hold', cancelled: 'Cancelled' };
            html += ' <span class="badge badge-' + (v.decision) + '">' + (decisionLabels[v.decision] || v.decision) + '</span>';
          }
          html += '</div>';
          if (v.comments) {
            html += '<div class="session-feedback-text">' + escHtml(v.comments).replace(/\n/g, '<br>') + '</div>';
          }
          html += '</div>';
        }

        html += '</div>'; // close session-version
      });
    }

    // ── Bottom section: status pipeline + feedback ──
    html += buildStatusPipeline(task);

    container.innerHTML = html;
  }

  function buildStatusPipeline(task) {
    var current = task.status || 'draft';
    var steps = [
      { key: 'draft',            label: 'Draft',     icon: '&#9998;'  },
      { key: 'pending_approval', label: 'Pending',   icon: '&#9679;'  },
      { key: 'approved',         label: 'Approved',  icon: '&#9654;'  },
      { key: 'revision_needed',  label: 'Improve',   icon: '&#9999;', needsFeedback: true },
      { key: 'in_progress',      label: 'Working',   icon: '&#9881;'  },
      { key: 'done',             label: 'Done',      icon: '&#10003;' }
    ];
    var sideStates = [
      { key: 'hold',      label: 'Hold',   icon: '&#9208;' },
      { key: 'cancelled', label: 'Cancel', icon: '&#10007;' }
    ];

    var html = '<div class="status-pipeline">';

    // Main flow
    html += '<div class="status-pipeline-row">';
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var isActive = s.key === current;
      var isPast = getStepIndex(current, steps) > i;
      var cls = 'status-step';
      if (isActive) cls += ' status-step-active';
      else if (isPast) cls += ' status-step-past';
      var onclick = s.needsFeedback ? 'App.toggleFeedback()' : 'App.changeTaskStatus(\'' + s.key + '\')';
      html += '<button class="' + cls + '" onclick="' + onclick + '" title="' + (s.needsFeedback ? 'Send feedback for revision' : 'Set to ' + s.label) + '">';
      html += '<span class="status-step-icon">' + s.icon + '</span>';
      html += '<span class="status-step-label">' + s.label + '</span>';
      html += '</button>';
      if (i < steps.length - 1) html += '<span class="status-step-arrow' + (isPast ? ' status-step-arrow-past' : '') + '">&#8250;</span>';
    }
    html += '</div>';

    // Side states (hold, cancel) + improve
    html += '<div class="status-pipeline-side">';
    for (var j = 0; j < sideStates.length; j++) {
      var ss = sideStates[j];
      var isActiveSide = ss.key === current;
      html += '<button class="status-step status-step-side' + (isActiveSide ? ' status-step-active' : '') + '" onclick="App.changeTaskStatus(\'' + ss.key + '\')" title="Set to ' + ss.label + '">';
      html += '<span class="status-step-icon">' + ss.icon + '</span>';
      html += '<span class="status-step-label">' + ss.label + '</span>';
      html += '</button>';
    }
    html += '</div>';

    html += '</div>';

    // Feedback area (hidden by default)
    html += '<div id="task-feedback-area" class="task-feedback-area hidden">';
    html += '<textarea id="task-review-comments" placeholder="Write feedback for the agent..."></textarea>';
    html += '<div class="task-feedback-actions">';
    html += '<button class="btn btn-primary" onclick="App.reviewTask(\'improve\')">Send Feedback</button>';
    html += '<button class="attach-image-btn" onclick="App.attachTaskImage()" title="Paste image from clipboard">&#128203; Attach Image</button>';
    html += '<button class="btn btn-secondary" onclick="App.toggleFeedback()">Cancel</button>';
    html += '</div>';
    html += '<div id="feedback-image-area"></div>';
    html += '</div>';

    // Result display
    if (task.result && (current === 'done' || current === 'approved')) {
      html += '<div class="session-outcome' + (current === 'approved' ? ' session-outcome-executing' : '') + '">';
      if (current === 'approved') {
        html += '<span class="session-outcome-icon">&#9654;</span><span>Executing</span><span class="agent-working-dot"></span>';
      }
      html += '<div class="session-outcome-result">' + linkifyText(escHtml(task.result)).replace(/\n/g, '<br>') + '</div>';
      html += '</div>';
    }

    return html;
  }

  function getStepIndex(status, steps) {
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].key === status) return i;
    }
    return -1;
  }

  function toggleFeedback() {
    var area = document.getElementById('task-feedback-area');
    if (area) area.classList.toggle('hidden');
  }

  // ── Clipboard Image Helpers ──────────────────────
  async function readClipboardImage() {
    try {
      var items = await navigator.clipboard.read();
      for (var i = 0; i < items.length; i++) {
        var types = items[i].types;
        for (var t = 0; t < types.length; t++) {
          if (types[t] === 'image/png' || types[t] === 'image/jpeg') {
            var blob = await items[i].getType(types[t]);
            return blob;
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function blobToBase64(blob) {
    // Compress image to fit within server body limit (5MB)
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var maxDim = 1920;
        var w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          var ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }

  async function pasteImage() {
    var blob = await readClipboardImage();
    if (!blob) {
      toast('No image found in clipboard', 'error');
      return;
    }
    try {
      var b64 = await blobToBase64(blob);
      var result = await api.post('/api/upload-image', { data: b64, destination: 'clipboard' });
      var previewArea = document.getElementById('paste-preview-area');
      var previewImg = document.getElementById('paste-preview-img');
      var previewPath = document.getElementById('paste-preview-path');
      if (previewArea && previewImg && previewPath) {
        previewImg.src = URL.createObjectURL(blob);
        previewPath.textContent = result.path;
        previewArea.classList.remove('hidden');
      }
      toast('Image saved: ' + result.path);
    } catch (e) {
      toast('Failed to upload image: ' + e.message, 'error');
    }
  }

  async function attachTaskImage() {
    var taskId = state.currentTaskId;
    if (!taskId) { toast('No task selected', 'error'); return; }
    var blob = await readClipboardImage();
    if (!blob) {
      toast('No image found in clipboard', 'error');
      return;
    }
    try {
      var b64 = await blobToBase64(blob);
      var result = await api.post('/api/upload-image', { data: b64, destination: 'task', taskId: taskId });
      var area = document.getElementById('feedback-image-area');
      if (area) {
        var img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.className = 'feedback-image-preview';
        area.innerHTML = '';
        area.appendChild(img);
        var pathSpan = document.createElement('span');
        pathSpan.className = 'paste-path';
        pathSpan.textContent = result.path;
        pathSpan.style.display = 'block';
        pathSpan.style.marginTop = '4px';
        area.appendChild(pathSpan);
      }
      // Append path to feedback textarea
      var textarea = document.getElementById('task-review-comments');
      if (textarea) {
        var sep = textarea.value.trim() ? '\n' : '';
        textarea.value += sep + '[Attached image: ' + result.path + ']';
      }
      toast('Image attached: ' + result.path);
    } catch (e) {
      toast('Failed to upload image: ' + e.message, 'error');
    }
  }

  async function changeTaskStatus(newStatus) {
    var id = state.currentTaskId;
    if (!id) return;
    // All pipeline clicks are lightweight — just update status, no timeline entry.
    // Only Feedback (improve via reviewTask) writes to the version timeline.
    try {
      await api.put('/api/tasks/' + id, { status: newStatus });
      var labels = {
        draft: 'Set to draft', pending_approval: 'Pending approval',
        approved: 'Approved for execution', revision_needed: 'Revision requested',
        in_progress: 'In progress', done: 'Task completed',
        hold: 'Task on hold', cancelled: 'Task cancelled'
      };
      toast(labels[newStatus] || 'Status updated');
      await openTask(id);
    } catch(e) {
      toast('Failed: ' + e.message, 'error');
    }
  }


  async function reviewTask(action) {
    var id = state.currentTaskId;
    if (!id) return;
    var commentsEl = document.getElementById('task-review-comments');
    var comments = commentsEl ? commentsEl.value.trim() : '';
    if (!comments) {
      toast('Please add feedback for the agent', 'error');
      if (commentsEl) commentsEl.focus();
      return;
    }
    try {
      await api.put('/api/tasks/' + id, { action: 'improve', comments: comments });
      toast('Feedback sent — revision requested');
      await openTask(id);
    } catch(e) {
      toast('Failed: ' + e.message, 'error');
    }
  }

  // Legacy — kept for compatibility but no longer rendered as separate panel
  async function renderProgressLog(taskId, task) { }
  async function renderVersionTimeline(taskId) { }

  function showFilePreview(filename, content) {
    var overlay = document.getElementById('file-preview-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'file-preview-overlay';
      overlay.className = 'file-preview-overlay';
      overlay.innerHTML = '<div class="file-preview-modal"><div class="file-preview-header"><span class="file-preview-title"></span><button class="btn btn-secondary" onclick="document.getElementById(\'file-preview-overlay\').classList.add(\'hidden\')">Close</button></div><div class="file-preview-body"></div></div>';
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.file-preview-title').textContent = filename;
    var body = overlay.querySelector('.file-preview-body');
    if (filename.endsWith('.md') && typeof marked !== 'undefined' && marked.parse) {
      body.innerHTML = marked.parse(content);
    } else {
      body.innerHTML = '<pre>' + escHtml(content) + '</pre>';
    }
    overlay.classList.remove('hidden');
  }

  async function viewVersionFile(el) {
    var taskId = el.dataset.task;
    var version = el.dataset.version;
    var file = el.dataset.file;
    try {
      var data = await api.get('/api/tasks/' + taskId + '/versions/' + version + '/files/' + encodeURIComponent(file));
      showFilePreview(file, data.content);
    } catch(e) {
      toast('Failed to load file', 'error');
    }
  }

  async function viewFile(filePath) {
    try {
      var data = await api.get('/api/file/' + encodeURIComponent(filePath));
      var filename = filePath.split('/').pop();
      showFilePreview(filename, data.content);
    } catch(e) {
      toast('Failed to load file', 'error');
    }
  }

  async function promoteToKnowledge() {
    var id = state.currentTaskId;
    if (!id) return;
    try {
      await api.post('/api/tasks/' + id + '/promote');
      toast('Promoted to Knowledge Base');
      await openTask(id);
    } catch(e) {
      toast('Failed: ' + (e.body && e.body.error ? e.body.error : e.message), 'error');
    }
  }

  // ── Knowledge Base ──────────────────────────────
  var knowledgeFilter = 'all';

  async function loadKnowledge() {
    try {
      var data = await api.get('/api/knowledge');
      var docs = data.documents || [];

      // Apply filter
      var filtered = knowledgeFilter === 'all' ? docs : docs.filter(function(d) { return d.category === knowledgeFilter; });

      var grid = document.getElementById('knowledge-grid');
      if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state">No ' + (knowledgeFilter === 'all' ? '' : knowledgeFilter + ' ') + 'documents yet</div>';
        return;
      }

      grid.innerHTML = filtered.map(function(doc) {
        var catClass = 'badge-cat-' + (doc.category || 'reference');
        var agentName = doc.authorAgentId || '';
        if (doc.authorAgentId && state.agents.length > 0) {
          var found = state.agents.find(function(a) { return a.id === doc.authorAgentId; });
          if (found) agentName = found.name;
        }
        // Check staleness (>30 days)
        var isStale = doc.updatedAt && (Date.now() - new Date(doc.updatedAt).getTime() > 30 * 24 * 60 * 60 * 1000);
        var staleHtml = isStale ? ' <span class="badge badge-stale">stale</span>' : '';

        var tagsHtml = (doc.tags || []).map(function(t) { return '<span class="tag-badge">' + escHtml(t) + '</span>'; }).join('');

        return '<div class="knowledge-card" onclick="App.openKnowledgeDoc(\'' + doc.id + '\')">' +
          '<div class="knowledge-card-info">' +
            '<div class="knowledge-card-title">' + escHtml(doc.title) + staleHtml + '</div>' +
            '<div class="knowledge-card-meta">' +
              '<span class="badge ' + catClass + '">' + escHtml(doc.category || 'reference') + '</span>' +
              (agentName ? '<span>' + escHtml(agentName) + '</span>' : '') +
              '<span>' + (doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : '') + '</span>' +
            '</div>' +
            (tagsHtml ? '<div class="knowledge-card-tags" style="margin-top:4px">' + tagsHtml + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    } catch(e) {
      console.error('Failed to load knowledge:', e);
    }
  }

  function filterKnowledge(filter) {
    knowledgeFilter = filter;
    document.querySelectorAll('#knowledge-filter-bar .filter-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    loadKnowledge();
  }

  async function openKnowledgeDoc(id) {
    try {
      var [meta, contentData] = await Promise.all([
        api.get('/api/knowledge/' + id),
        api.get('/api/knowledge/' + id + '/content')
      ]);

      document.getElementById('knowledge-detail-title').textContent = meta.title || 'Untitled';

      // Meta bar
      var metaEl = document.getElementById('knowledge-detail-meta');
      var catClass = 'badge-cat-' + (meta.category || 'reference');
      var agentName = meta.authorAgentId || '';
      if (meta.authorAgentId && state.agents.length > 0) {
        var found = state.agents.find(function(a) { return a.id === meta.authorAgentId; });
        if (found) agentName = found.name;
      }
      var isStale = meta.updatedAt && (Date.now() - new Date(meta.updatedAt).getTime() > 30 * 24 * 60 * 60 * 1000);
      var metaHtml = '<span class="badge ' + catClass + '">' + escHtml(meta.category || 'reference') + '</span>';
      if (agentName) metaHtml += '<span>By: ' + escHtml(agentName) + '</span>';
      metaHtml += '<span>' + (meta.createdAt ? new Date(meta.createdAt).toLocaleDateString() : '') + '</span>';
      if (meta.tags && meta.tags.length) metaHtml += meta.tags.map(function(t) { return '<span class="tag-badge">' + escHtml(t) + '</span>'; }).join('');
      if (isStale) metaHtml += '<span class="badge badge-stale">stale</span>';
      if (meta.sourceTaskId) metaHtml += '<a style="color:var(--accent);cursor:pointer" onclick="App.openTask(\'' + meta.sourceTaskId + '\')">Source task</a>';
      metaEl.innerHTML = metaHtml;

      // Summary
      var summaryPanel = document.getElementById('knowledge-summary-panel');
      if (meta.summary) {
        summaryPanel.style.display = '';
        document.getElementById('knowledge-detail-summary').textContent = meta.summary;
      } else {
        summaryPanel.style.display = 'none';
      }

      // Content
      var contentEl = document.getElementById('knowledge-detail-content');
      var raw = contentData.content || '';
      try {
        contentEl.innerHTML = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(raw) : raw.replace(/</g, '&lt;').replace(/\n/g, '<br>');
      } catch(e) {
        contentEl.innerHTML = raw.replace(/</g, '&lt;').replace(/\n/g, '<br>');
      }

      state._currentKnowledgeId = id;
      navigate('knowledge-detail');
    } catch(e) {
      toast('Failed to load document', 'error');
    }
  }

  async function deleteKnowledgeDoc() {
    if (!state._currentKnowledgeId) return;
    var ok = await confirmAction({
      title: 'Delete Document',
      message: 'This will permanently delete this knowledge document. This cannot be undone.',
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      await api.del('/api/knowledge/' + state._currentKnowledgeId);
      toast('Document deleted');
      navigate('knowledge');
    } catch(e) {
      toast('Failed to delete', 'error');
    }
  }

  function navigateBack() {
    if (state.previousView === 'agent-detail' && state.previousAgentId) {
      navigate('agent-detail', state.previousAgentId);
    } else {
      navigate('dashboard');
    }
  }

  // ── Media Filter ──────────────────────────────
  function filterMedia(filter) {
    state.mediaFilter = filter;
    document.querySelectorAll('#view-media .filter-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    loadMedia();
  }


  // ── Agent CRUD ─────────────────────────────────────
  function clearAgentForm() {
    ['af-name','af-role','af-mission','af-desc','af-traits','af-tone','af-style','af-rules','af-caps'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
  }

  function fillAgentForm(agent) {
    document.getElementById('af-name').value = agent.name || '';
    document.getElementById('af-role').value = agent.role || '';
    document.getElementById('af-mission').value = agent.mission || '';
    document.getElementById('af-desc').value = agent.description || '';
    var p = agent.personality || {};
    document.getElementById('af-traits').value = (p.traits || []).join(', ');
    document.getElementById('af-tone').value = p.tone || '';
    document.getElementById('af-style').value = p.style || '';
    document.getElementById('af-rules').value = (agent.rules || []).join('\n');
    document.getElementById('af-caps').value = (agent.capabilities || []).join(', ');
  }

  function getAgentFormData() {
    return {
      name: document.getElementById('af-name').value.trim(),
      role: document.getElementById('af-role').value.trim(),
      mission: document.getElementById('af-mission').value.trim(),
      description: document.getElementById('af-desc').value.trim(),
      personality: {
        traits: document.getElementById('af-traits').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
        tone: document.getElementById('af-tone').value.trim(),
        style: document.getElementById('af-style').value.trim(),
      },
      rules: document.getElementById('af-rules').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean),
      capabilities: document.getElementById('af-caps').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    };
  }

  async function saveAgent() {
    var data = getAgentFormData();
    if (!data.name) { toast('Agent name is required', 'error'); return; }

    try {
      if (state.editingAgentId) {
        await api.put('/api/agents/' + state.editingAgentId, data);
        toast('Agent updated');
        navigate('agent-detail', state.editingAgentId);
      } else {
        var created = await api.post('/api/agents', data);
        toast('Agent created');
        navigate('agent-detail', created.id);
      }
    } catch(e) {
      toast('Failed to save agent', 'error');
      console.error(e);
    }
  }

  async function editAgent() {
    if (!state.currentAgentId) return;
    try {
      var agent = await api.get('/api/agents/' + state.currentAgentId);
      state.editingAgentId = state.currentAgentId;
      navigate('add-agent');
      document.getElementById('agent-form-title').textContent = 'Edit Agent';
      document.getElementById('af-submit').textContent = 'Save Changes';
      fillAgentForm(agent);
    } catch(e) {
      toast('Failed to load agent for editing', 'error');
    }
  }

  async function deleteAgent() {
    if (!state.currentAgentId) return;
    var ok = await confirmAction({
      title: 'Delete Agent',
      message: 'This will permanently delete this agent and all their data. This cannot be undone.',
      confirmLabel: 'Delete Agent'
    });
    if (!ok) return;
    try {
      await api.del('/api/agents/' + state.currentAgentId);
      toast('Agent deleted');
      state.currentAgentId = null;
      navigate('dashboard');
    } catch(e) {
      toast('Failed to delete agent', 'error');
    }
  }

  async function clearShortMemory() {
    if (!state.currentAgentId) return;
    var ok = await confirmAction({
      title: 'Clear Short Memory',
      message: 'This will erase all short-term memory for this agent. This cannot be undone.',
      confirmLabel: 'Clear Memory'
    });
    if (!ok) return;
    try {
      await api.put('/api/agents/' + state.currentAgentId + '/memory/short', { content: '' });
      document.getElementById('agent-detail-short-mem').textContent = 'Empty';
      toast('Short memory cleared');
    } catch(e) { toast('Failed to clear memory', 'error'); }
  }

  function toggleMemoryEdit(type) {
    var editor = document.getElementById(type + '-mem-editor');
    var display = document.getElementById('agent-detail-' + type + '-mem');
    var textarea = document.getElementById(type + '-mem-textarea');
    var isHidden = editor.classList.contains('hidden');
    if (isHidden) {
      textarea.value = display.textContent === 'Empty' ? '' : display.textContent;
      editor.classList.remove('hidden');
      display.classList.add('hidden');
    } else {
      editor.classList.add('hidden');
      display.classList.remove('hidden');
    }
  }

  async function saveMemory(type) {
    if (!state.currentAgentId) return;
    var textarea = document.getElementById(type + '-mem-textarea');
    var content = textarea.value.trim();
    try {
      await api.put('/api/agents/' + state.currentAgentId + '/memory/' + type, { content: content });
      document.getElementById('agent-detail-' + type + '-mem').textContent = content || 'Empty';
      document.getElementById(type + '-mem-editor').classList.add('hidden');
      document.getElementById('agent-detail-' + type + '-mem').classList.remove('hidden');
      toast(type.charAt(0).toUpperCase() + type.slice(1) + ' memory saved');
    } catch(e) { toast('Failed to save memory', 'error'); }
  }

  // ── Templates ──────────────────────────────────────
  async function loadTemplatesForPicker(containerId) {
    try {
      state.templates = await api.get('/api/templates');
    } catch(e) { state.templates = []; }

    var container = document.getElementById(containerId);
    if (!container) return;

    var html = '<div class="template-card template-card-blank" onclick="App.selectTemplate(null, \'' + containerId + '\')"><h4>Blank</h4><p>Start from scratch</p></div>';
    html += state.templates.map(function(t) {
      return '<div class="template-card" data-template="' + t.templateId + '" onclick="App.selectTemplate(\'' + t.templateId + '\', \'' + containerId + '\')">' +
        '<h4>' + escHtml(t.name) + '</h4><p>' + escHtml(t.role) + '</p></div>';
    }).join('');
    container.innerHTML = html;
  }

  function selectTemplate(templateId, containerId) {
    var container = document.getElementById(containerId);
    container.querySelectorAll('.template-card').forEach(function(c) { c.classList.remove('selected'); });
    if (templateId) {
      var card = container.querySelector('[data-template="' + templateId + '"]');
      if (card) card.classList.add('selected');
    } else {
      container.querySelector('.template-card-blank').classList.add('selected');
    }

    if (!templateId) {
      clearAgentForm();
      return;
    }

    var tmpl = state.templates.find(function(t) { return t.templateId === templateId; });
    if (!tmpl) return;
    fillAgentForm(tmpl);
  }

  // ── Profile Editor ─────────────────────────────────
  async function loadProfileEditor() {
    try {
      var p = await api.get('/api/profile');
      document.getElementById('pf-name').value = p.name || '';
      document.getElementById('pf-role').value = p.role || '';
      document.getElementById('pf-expertise').value = p.expertise || '';
      document.getElementById('pf-goals').value = p.goals || '';
      document.getElementById('pf-audience').value = p.targetAudience || '';
      document.getElementById('pf-voice').value = p.brandVoice || '';
      document.getElementById('pf-comm-style').value = p.communicationStyle || '';
    } catch(e) { console.error('Failed to load profile:', e); }
  }

  async function saveProfile() {
    var data = {
      name: document.getElementById('pf-name').value.trim(),
      role: document.getElementById('pf-role').value.trim(),
      expertise: document.getElementById('pf-expertise').value.trim(),
      goals: document.getElementById('pf-goals').value.trim(),
      targetAudience: document.getElementById('pf-audience').value.trim(),
      brandVoice: document.getElementById('pf-voice').value.trim(),
      communicationStyle: document.getElementById('pf-comm-style').value.trim(),
    };
    try {
      await api.put('/api/profile', data);
      toast('Profile saved');
    } catch(e) { toast('Failed to save profile', 'error'); }
  }

  // ── Rules Editor ───────────────────────────────────
  async function loadRulesEditor() {
    try {
      var [team, security] = await Promise.all([
        api.get('/api/rules/team'),
        api.get('/api/rules/security'),
      ]);
      document.getElementById('rules-team').value = team.content || '';
      document.getElementById('rules-security').value = security.content || '';
    } catch(e) { console.error('Failed to load rules:', e); }
  }

  async function saveRules(type) {
    var content = document.getElementById('rules-' + type).value;
    try {
      await api.put('/api/rules/' + type, { content: content });
      toast(type.charAt(0).toUpperCase() + type.slice(1) + ' rules saved');
    } catch(e) { toast('Failed to save rules', 'error'); }
  }

  // ── Settings ───────────────────────────────────────
  async function loadSettings() {
    try {
      var sys = await api.get('/api/system/status');
      var agents = await api.get('/api/agents');
      document.getElementById('settings-team-name').textContent = sys.teamName || '-';
      document.getElementById('settings-version').textContent = sys.version || '1.0.0';
      document.getElementById('settings-agent-count').textContent = (agents.agents || []).length;
    } catch(e) { console.error('Failed to load settings:', e); }
    checkClaudeStatus();
    loadPermissionMode();
    checkForUpdates();
    loadSecretsStatus();
    loadTempStatus();
    loadAutopilot();
  }

  async function loadTempStatus() {
    try {
      var result = await api.get('/api/temp/status');
      var el = document.getElementById('temp-status');
      if (el) el.textContent = result.fileCount + ' files, ' + result.totalSizeMB + ' MB';
    } catch(e) {
      var el = document.getElementById('temp-status');
      if (el) el.textContent = '-';
    }
  }

  async function cleanupTemp() {
    if (!confirm('Delete all files in the temp workspace?')) return;
    try {
      await api.post('/api/temp/cleanup', {});
      toast('Temp folder cleaned');
      loadTempStatus();
    } catch(e) { toast('Failed to clean temp', 'error'); }
  }

  async function rebuildContext() {
    try {
      await api.post('/api/rebuild-context', {});
      toast('CLAUDE.md rebuilt');
    } catch(e) { toast('Failed to rebuild context', 'error'); }
  }

  async function resetSystem() {
    var ok = await confirmAction({
      title: 'Reset Entire System',
      message: 'This will reset the system to its initial state. You will see the setup wizard on next load. This is a destructive action.',
      confirmLabel: 'Reset System',
      requireText: 'reset'
    });
    if (!ok) return;
    try {
      await api.post('/api/write-file', { path: 'config/system.json', content: JSON.stringify({ initialized: false, teamName: '', teamDescription: '', version: '1.0.0' }, null, 2) });
      toast('System reset. Reload the page to see the wizard.');
    } catch(e) { toast('Failed to reset', 'error'); }
  }

  async function resetAgents() {
    var ok = await confirmAction({
      title: 'Delete All Sub-Agents',
      message: 'This will permanently delete ALL sub-agents. Only the orchestrator will remain. This cannot be undone.',
      confirmLabel: 'Delete All Agents',
      requireText: 'reset'
    });
    if (!ok) return;
    try {
      await api.post('/api/agents/reset', {});
      await loadSidebarAgents();
      toast('All sub-agents deleted. Orchestrator remains.');
      if (state.currentView === 'agent-detail') navigate('dashboard');
    } catch(e) { toast('Failed to reset agents', 'error'); }
  }

  // ── Permission Mode ─────────────────────────────────
  var permModeDescs = {
    autonomous: 'Claude works independently with full tool access. Best for unattended work. Safety boundaries in CLAUDE.md still apply.',
    supervised: 'Claude asks for permission before using each tool. Best when you want manual control over every action.',
  };

  async function loadPermissionMode() {
    var select = document.getElementById('permission-mode-select');
    var desc = document.getElementById('permission-mode-desc');
    if (!select) return;
    try {
      var result = await api.get('/api/settings/permission-mode');
      select.value = result.mode || 'autonomous';
      if (desc) desc.textContent = permModeDescs[select.value] || '';
    } catch(e) {
      select.value = 'autonomous';
      if (desc) desc.textContent = permModeDescs.autonomous;
    }
  }

  async function savePermissionMode() {
    var select = document.getElementById('permission-mode-select');
    var desc = document.getElementById('permission-mode-desc');
    if (!select) return;
    var mode = select.value;
    if (desc) desc.textContent = permModeDescs[mode] || '';
    try {
      await api.put('/api/settings/permission-mode', { mode: mode });
      toast('Permission mode set to ' + mode + '. Restart terminal sessions to apply.');
    } catch(e) { toast('Failed to save permission mode', 'error'); }
  }

  // ── Secrets Management ──────────────────────────────
  async function loadSecretsStatus() {
    var badge = document.getElementById('secrets-status-badge');
    var unlockForm = document.getElementById('secrets-unlock-form');
    var setupForm = document.getElementById('secrets-setup-form');
    var listContainer = document.getElementById('secrets-list-container');
    var addForm = document.getElementById('secrets-add-form');
    if (!badge) return;

    // Hide all forms
    if (unlockForm) unlockForm.classList.add('hidden');
    if (setupForm) setupForm.classList.add('hidden');
    if (listContainer) listContainer.classList.add('hidden');
    if (addForm) addForm.classList.add('hidden');

    try {
      var status = await api.get('/api/secrets/status');
      if (!status.exists) {
        badge.textContent = 'Not configured';
        badge.className = 'badge badge-inactive';
        if (setupForm) setupForm.classList.remove('hidden');
      } else if (status.locked) {
        badge.textContent = 'Locked';
        badge.className = 'badge badge-pending';
        if (unlockForm) unlockForm.classList.remove('hidden');
      } else {
        badge.textContent = 'Unlocked (' + status.count + ' secret' + (status.count !== 1 ? 's' : '') + ')';
        badge.className = 'badge badge-active';
        if (listContainer) listContainer.classList.remove('hidden');
        loadSecretsList();
      }
    } catch(e) {
      badge.textContent = 'Error';
      badge.className = 'badge badge-inactive';
    }
  }

  async function loadSecretsList() {
    var listEl = document.getElementById('secrets-list');
    if (!listEl) return;
    try {
      var data = await api.get('/api/secrets');
      if (!data.secrets || data.secrets.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No secrets stored</div>';
        return;
      }
      listEl.innerHTML = data.secrets.map(function(s) {
        return '<div class="secret-item">' +
          '<span class="secret-name">' + escHtml(s.name) + '</span>' +
          '<span class="secret-value">' + escHtml(s.maskedValue) + '</span>' +
          '<span class="secret-actions">' +
            '<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" onclick="App.editSecret(' + q + s.name + q + ')">Edit</button>' +
            '<button class="btn btn-cancel" style="font-size:11px;padding:3px 8px" onclick="App.deleteSecret(' + q + s.name + q + ')">Delete</button>' +
          '</span>' +
        '</div>';
      }).join('');
    } catch(e) {
      listEl.innerHTML = '<div class="empty-state">Failed to load secrets</div>';
    }
  }

  async function unlockSecrets() {
    var pw = document.getElementById('secrets-master-password');
    if (!pw || !pw.value) { toast('Enter the master password', 'error'); return; }
    try {
      await api.post('/api/secrets/unlock', { password: pw.value });
      pw.value = '';
      toast('Secrets unlocked');
      loadSecretsStatus();
    } catch(e) {
      toast('Invalid master password', 'error');
    }
  }

  async function lockSecrets() {
    try {
      await api.post('/api/secrets/lock', {});
      toast('Secrets locked');
      loadSecretsStatus();
    } catch(e) { toast('Failed to lock secrets', 'error'); }
  }

  async function initializeSecrets() {
    var pw = document.getElementById('secrets-new-master-password');
    var confirm = document.getElementById('secrets-confirm-master-password');
    if (!pw || !pw.value) { toast('Enter a master password', 'error'); return; }
    if (pw.value !== confirm.value) { toast('Passwords do not match', 'error'); return; }
    if (pw.value.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
    // Create vault with a placeholder, then show add form
    try {
      secretsInitPassword = pw.value;
      pw.value = ''; confirm.value = '';
      toast('Vault created! Add your first secret.');
      document.getElementById('secrets-setup-form').classList.add('hidden');
      document.getElementById('secrets-add-form').classList.remove('hidden');
    } catch(e) { toast('Failed to create vault', 'error'); }
  }

  var secretsInitPassword = null;

  function showAddSecret() {
    var addForm = document.getElementById('secrets-add-form');
    if (addForm) addForm.classList.remove('hidden');
    document.getElementById('secret-add-name').value = '';
    document.getElementById('secret-add-value').value = '';
  }

  function cancelAddSecret() {
    document.getElementById('secrets-add-form').classList.add('hidden');
    secretsInitPassword = null;
  }

  async function saveSecret() {
    var nameEl = document.getElementById('secret-add-name');
    var valueEl = document.getElementById('secret-add-value');
    var name = nameEl.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    var value = valueEl.value;
    if (!name || !value) { toast('Name and value are required', 'error'); return; }

    var body = { name: name, value: value };
    if (secretsInitPassword) {
      body.password = secretsInitPassword;
      secretsInitPassword = null;
    }

    try {
      await api.post('/api/secrets', body);
      toast('Secret saved');
      document.getElementById('secrets-add-form').classList.add('hidden');
      loadSecretsStatus();
    } catch(e) { toast('Failed to save secret', 'error'); }
  }

  async function editSecret(name) {
    var nameEl = document.getElementById('secret-add-name');
    var valueEl = document.getElementById('secret-add-value');
    nameEl.value = name;
    valueEl.value = '';
    valueEl.placeholder = 'Enter new value';
    document.getElementById('secrets-add-form').classList.remove('hidden');
  }

  async function deleteSecret(name) {
    if (!confirm('Delete secret "' + name + '"? This cannot be undone.')) return;
    try {
      await api.del('/api/secrets/' + encodeURIComponent(name));
      toast('Secret deleted');
      loadSecretsStatus();
    } catch(e) { toast('Failed to delete secret', 'error'); }
  }

  async function changeSecretsPassword() {
    var current = prompt('Enter current master password:');
    if (!current) return;
    var newPw = prompt('Enter new master password:');
    if (!newPw) return;
    var confirmPw = prompt('Confirm new password:');
    if (newPw !== confirmPw) { toast('Passwords do not match', 'error'); return; }
    try {
      await api.post('/api/secrets/change-password', { currentPassword: current, newPassword: newPw });
      toast('Master password changed');
    } catch(e) { toast('Failed to change password. Check current password.', 'error'); }
  }

  // ── Software Updates ─────────────────────────────────
  async function checkForUpdates() {
    var statusEl = document.getElementById('update-status');
    var currentEl = document.getElementById('update-current-version');
    var latestEl = document.getElementById('update-latest-version');
    var releaseInfo = document.getElementById('update-release-info');
    var releaseNameEl = document.getElementById('update-release-name');
    var releaseNotesEl = document.getElementById('update-release-notes');
    var releaseUrlEl = document.getElementById('update-release-url');
    var upgradeBtn = document.getElementById('update-upgrade-btn');
    var banner = document.getElementById('update-banner');

    if (statusEl) { statusEl.textContent = 'Checking...'; statusEl.className = 'badge badge-inactive'; }
    if (releaseInfo) releaseInfo.classList.add('hidden');

    try {
      var result = await api.get('/api/updates/check');

      if (currentEl) currentEl.textContent = result.currentVersion || '-';
      if (latestEl) latestEl.textContent = result.latestVersion || '-';

      if (result.error) {
        if (statusEl) { statusEl.textContent = 'Check failed'; statusEl.className = 'badge badge-inactive'; }
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        toast(result.error, 'error');
        return;
      }

      if (result.updateAvailable) {
        if (statusEl) { statusEl.textContent = 'Update available'; statusEl.className = 'badge badge-pending'; }
        if (upgradeBtn) upgradeBtn.classList.remove('hidden');
        if (banner) banner.classList.remove('hidden');
        if (releaseInfo) {
          releaseInfo.classList.remove('hidden');
          if (releaseNameEl) releaseNameEl.textContent = result.releaseName || ('v' + result.latestVersion);
          if (releaseNotesEl) {
            releaseNotesEl.innerHTML = result.releaseNotes ? (typeof marked !== 'undefined' ? marked.parse(result.releaseNotes) : escHtml(result.releaseNotes)) : '';
          }
          if (releaseUrlEl && result.releaseUrl) { releaseUrlEl.href = result.releaseUrl; }
        }
        toast('Update available: v' + result.latestVersion);
      } else {
        if (statusEl) { statusEl.textContent = 'Up to date'; statusEl.className = 'badge badge-active'; }
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        toast('You are up to date');
      }
    } catch(e) {
      if (statusEl) { statusEl.textContent = 'Error'; statusEl.className = 'badge badge-inactive'; }
      console.error('Update check failed:', e);
    }
  }

  async function performUpgrade() {
    if (!confirm('Upgrade the platform? This will download and replace platform files only — your agents, tasks, secrets, and project data will NOT be changed. The server will need a restart after upgrading.')) return;

    var upgradeBtn = document.getElementById('update-upgrade-btn');
    if (upgradeBtn) { upgradeBtn.disabled = true; upgradeBtn.textContent = 'Downloading...'; }

    try {
      var result = await api.post('/api/updates/upgrade', {});
      if (result.success) {
        toast('Upgrade complete! Restart the server to apply.');
        var statusEl = document.getElementById('update-status');
        if (statusEl) { statusEl.textContent = 'Restart required'; statusEl.className = 'badge badge-pending'; }
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        var banner = document.getElementById('update-banner');
        if (banner) banner.classList.add('hidden');
      } else {
        toast(result.message || 'Upgrade failed', 'error');
        if (upgradeBtn) { upgradeBtn.disabled = false; upgradeBtn.textContent = 'Upgrade Now'; }
      }
    } catch(e) {
      toast('Upgrade failed', 'error');
      if (upgradeBtn) { upgradeBtn.disabled = false; upgradeBtn.textContent = 'Upgrade Now'; }
      console.error('Upgrade error:', e);
    }
  }

  async function silentUpdateCheck() {
    try {
      var result = await api.get('/api/updates/check');
      var banner = document.getElementById('update-banner');
      if (result.updateAvailable && banner) {
        banner.classList.remove('hidden');
      }
    } catch(e) {}
  }

  // ── Claude Account Status ─────────────────────────
  async function checkClaudeStatus() {
    var installedEl = document.getElementById('claude-installed');
    var versionEl = document.getElementById('claude-version');
    if (!installedEl || !versionEl) return;

    installedEl.textContent = 'Checking...';
    installedEl.className = 'badge badge-inactive';
    versionEl.textContent = '-';

    try {
      var result = await api.get('/api/claude/status');
      if (result.installed) {
        installedEl.textContent = 'Installed';
        installedEl.className = 'badge badge-active';
        versionEl.textContent = result.version || 'Unknown';
      } else {
        installedEl.textContent = 'Not Installed';
        installedEl.className = 'badge badge-inactive';
        versionEl.textContent = '-';
      }
    } catch(e) {
      installedEl.textContent = 'Error';
      installedEl.className = 'badge badge-inactive';
    }
  }

  // ── Media ──────────────────────────────────────────
  var IMAGE_EXTS = ['png','jpg','jpeg','gif','svg','webp'];
  var VIDEO_EXTS = ['mp4','webm','mov','avi'];
  var DOC_EXTS = ['pdf','doc','docx','txt','md','csv','xls','xlsx'];

  function mediaTypeIcon(ext) {
    if (VIDEO_EXTS.indexOf(ext) >= 0) return '\uD83C\uDFAC';
    if (DOC_EXTS.indexOf(ext) >= 0) return '\uD83D\uDCC4';
    return '\uD83D\uDCC1';
  }

  async function loadMedia() {
    try {
      var files = await api.get('/api/ls/data/media');
      var el = document.getElementById('media-grid');
      var mediaFiles = files.filter(function(f) { return !f.isDir; });
      if (state.mediaFilter && state.mediaFilter !== 'all') {
        var extMap = { image: IMAGE_EXTS, video: VIDEO_EXTS, document: DOC_EXTS };
        var allowedExts = extMap[state.mediaFilter] || [];
        mediaFiles = mediaFiles.filter(function(f) {
          var ext = f.name.split('.').pop().toLowerCase();
          return allowedExts.indexOf(ext) >= 0;
        });
      }

      if (mediaFiles.length === 0) {
        el.innerHTML = '<div class="empty-state">No media files yet</div>';
        return;
      }
      el.innerHTML = mediaFiles.map(function(f) {
        var ext = f.name.split('.').pop().toLowerCase();
        var isImage = IMAGE_EXTS.indexOf(ext) >= 0;
        var typeStr = isImage ? 'image' : (VIDEO_EXTS.indexOf(ext) >= 0 ? 'video' : 'document');
        var truncName = f.name.length > 20 ? f.name.slice(0, 17) + '...' : f.name;
        if (isImage) {
          return '<div class="media-thumb" onclick="App.openMediaPreview(\'' + escHtml(f.name.replace(/'/g, "\\'")) + '\',\'' + typeStr + '\')">' +
            '<img src="/api/media/files/' + encodeURIComponent(f.name) + '" alt="' + escHtml(f.name) + '">' +
            '<div class="media-thumb-info"><span class="media-thumb-name" title="' + escHtml(f.name) + '">' + escHtml(truncName) + '</span></div></div>';
        }
        return '<div class="media-thumb" onclick="App.openMediaPreview(\'' + escHtml(f.name.replace(/'/g, "\\'")) + '\',\'' + typeStr + '\')">' +
          '<div class="media-thumb-icon">' + mediaTypeIcon(ext) + '</div>' +
          '<div class="media-thumb-info"><span class="media-thumb-name" title="' + escHtml(f.name) + '">' + escHtml(truncName) + '</span></div></div>';
      }).join('');
    } catch(e) {
      document.getElementById('media-grid').innerHTML = '<div class="empty-state">No media files yet</div>';
    }
  }

  function openMediaPreview(filename, type) {
    state.currentMediaFile = filename;
    var content = document.getElementById('media-preview-content');
    if (type === 'image') {
      content.innerHTML = '<img src="/api/media/files/' + encodeURIComponent(filename) + '" alt="' + escHtml(filename) + '" style="max-width:100%;max-height:70vh;display:block;margin:0 auto 12px;border-radius:6px">' +
        '<p style="text-align:center;color:var(--text-muted);font-size:13px">' + escHtml(filename) + '</p>';
    } else {
      var ext = filename.split('.').pop().toLowerCase();
      var icon = mediaTypeIcon(ext);
      content.innerHTML = '<div style="text-align:center;padding:32px">' +
        '<div style="font-size:64px;margin-bottom:16px">' + icon + '</div>' +
        '<p style="font-size:16px;font-weight:500;margin-bottom:8px">' + escHtml(filename) + '</p>' +
        '<p style="color:var(--text-muted);font-size:13px">Type: ' + escHtml(ext.toUpperCase()) + '</p></div>';
    }
    document.getElementById('media-preview-modal').classList.remove('hidden');
  }

  function closeMediaPreview() {
    document.getElementById('media-preview-modal').classList.add('hidden');
    state.currentMediaFile = null;
  }

  async function openMediaFolder() {
    if (!state.currentMediaFile) return;
    try {
      await api.post('/api/media/open-folder', { filename: state.currentMediaFile });
    } catch(e) {
      showToast('Could not open folder', 'error');
    }
  }

  // ── Terminal / Command Center ──────────────────────
  function setChatStatus(status) {
    var el = document.getElementById('chat-status');
    if (!el) return;
    el.className = 'chat-status ' + status;
    el.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
  }

  function initTerminal() {
    if (termInitialized && terminal) {
      // Already initialized, just re-fit
      if (fitAddon) setTimeout(function() { try { fitAddon.fit(); } catch(e) {} }, 50);
      // Reconnect WS if it died while on another tab
      if (!termWs || termWs.readyState > 1) {
        connectTerminalWs();
      }
      return;
    }

    var container = document.getElementById('terminal-container');
    if (!container) return;

    // Check if xterm.js loaded
    if (typeof Terminal === 'undefined') {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Terminal library failed to load. Check your internet connection and reload.</div>';
      return;
    }

    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88,166,255,0.3)',
        black: '#0d1117',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#76e3ea',
        white: '#e6edf3',
        brightBlack: '#8b949e',
        brightRed: '#f85149',
        brightGreen: '#3fb950',
        brightYellow: '#d29922',
        brightBlue: '#58a6ff',
        brightMagenta: '#bc8cff',
        brightCyan: '#76e3ea',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    if (typeof WebLinksAddon !== 'undefined') {
      terminal.loadAddon(new WebLinksAddon.WebLinksAddon());
    }

    terminal.open(container);
    fitAddon.fit();

    // Handle paste (Ctrl+V) and copy (Ctrl+C with selection)
    terminal.attachCustomKeyEventHandler(function(ev) {
      if (ev.type === 'keydown' && ev.ctrlKey) {
        if (ev.key === 'v') {
          navigator.clipboard.readText().then(function(text) {
            if (text && termWs && termWs.readyState === 1) {
              termWs.send(JSON.stringify({ type: 'input', data: text }));
            }
          }).catch(function() {});
          return false;
        }
        if (ev.key === 'c' && terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection()).catch(function() {});
          return false;
        }
      }
      return true;
    });

    // Handle user input -> send to server
    terminal.onData(function(data) {
      if (termWs && termWs.readyState === 1) {
        termWs.send(JSON.stringify({ type: 'input', data: data }));
      }
    });

    // Handle resize
    terminal.onResize(function(size) {
      if (termWs && termWs.readyState === 1) {
        termWs.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });

    // Re-fit on window resize
    window.addEventListener('resize', function() {
      if (fitAddon && state.currentView === 'chat') {
        try { fitAddon.fit(); } catch(e) {}
      }
    });

    termInitialized = true;
    connectTerminalWs();
  }

  function connectTerminalWs() {
    // Clear any pending reconnect
    if (termWsReconnectTimer) { clearTimeout(termWsReconnectTimer); termWsReconnectTimer = null; }

    // Reuse session ID from sessionStorage for tab persistence
    termSessionId = sessionStorage.getItem('termSessionId') || '';

    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.host + '/ws/terminal';
    if (termSessionId) wsUrl += '?session=' + encodeURIComponent(termSessionId);

    if (termWs) {
      try { termWs.close(); } catch(e) {}
    }

    termSessionEnded = false;
    termWs = new WebSocket(wsUrl);

    termWs.onopen = function() {
      setChatStatus('connected');
      // Send initial resize
      if (terminal && fitAddon) {
        try { fitAddon.fit(); } catch(e) {}
        termWs.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
    };

    termWs.onmessage = function(evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'terminal-output' && terminal) {
          terminal.write(data.data);
        } else if (data.type === 'terminal-ready') {
          termSessionId = data.session;
          sessionStorage.setItem('termSessionId', termSessionId);
          termSessionEnded = false;
        } else if (data.type === 'terminal-exit') {
          termSessionEnded = true;
          if (terminal) {
            terminal.write('\r\n\x1b[33m[Session ended. Click Restart to start a new session.]\x1b[0m\r\n');
          }
        } else if (data.type === 'terminal-error') {
          if (terminal) {
            terminal.write('\r\n\x1b[31m' + data.error + '\x1b[0m\r\n');
          }
        }
      } catch(e) {
        console.error('Terminal WS parse error:', e);
      }
    };

    termWs.onclose = function() {
      setChatStatus('disconnected');
      // Auto-reconnect after 3s unless the session intentionally ended
      if (!termSessionEnded) {
        termWsReconnectTimer = setTimeout(function() {
          if (termInitialized && (!termWs || termWs.readyState > 1)) {
            connectTerminalWs();
          }
        }, 3000);
      }
    };

    termWs.onerror = function() {
      setChatStatus('disconnected');
    };
  }

  function restartTerminal() {
    termSessionEnded = false;
    if (termWs && termWs.readyState === 1) {
      termWs.send(JSON.stringify({ type: 'restart' }));
      if (terminal) terminal.clear();
    } else {
      // Reconnect fresh
      sessionStorage.removeItem('termSessionId');
      termSessionId = '';
      if (terminal) terminal.clear();
      connectTerminalWs();
    }
  }

  // ── Wizard (5 steps) ──────────────────────────────
  function wizardNext() {
    // Step 4 = orchestrator, prepare summary for step 5
    if (state.wizardStep === 4) {
      var orchName = document.getElementById('wiz-orch-name') ? document.getElementById('wiz-orch-name').value : 'Orchestrator';
      var summary = '<strong>Profile:</strong> ' + escHtml(document.getElementById('wiz-name').value || 'Not set') + '<br>' +
        '<strong>Team:</strong> ' + escHtml(document.getElementById('wiz-team-name').value || 'Not set') + '<br>' +
        '<strong>Orchestrator:</strong> ' + escHtml(orchName || 'Orchestrator');
      document.getElementById('wizard-summary').innerHTML = summary;
    }
    if (state.wizardStep < 5) {
      state.wizardStep++;
      updateWizardStep();
    }
  }

  function wizardBack() {
    if (state.wizardStep > 1) {
      state.wizardStep--;
      updateWizardStep();
    }
  }

  function updateWizardStep() {
    document.querySelectorAll('.wizard-step').forEach(function(s) {
      s.classList.toggle('active', parseInt(s.dataset.step) === state.wizardStep);
    });
    document.getElementById('wizard-progress-bar').style.width = Math.round(state.wizardStep / 5 * 100) + '%';
  }

  async function wizardFinish() {
    try {
      var profile = {
        name: document.getElementById('wiz-name').value.trim(),
        role: document.getElementById('wiz-role').value.trim(),
        expertise: document.getElementById('wiz-expertise').value.trim(),
        goals: document.getElementById('wiz-goals').value.trim(),
        targetAudience: document.getElementById('wiz-audience').value.trim(),
        brandVoice: document.getElementById('wiz-voice').value.trim(),
      };
      await api.put('/api/profile', profile);

      var teamName = document.getElementById('wiz-team-name').value.trim() || 'My Team';
      var teamDesc = document.getElementById('wiz-team-desc').value.trim();
      await api.post('/api/write-file', {
        path: 'config/system.json',
        content: JSON.stringify({ initialized: true, teamName: teamName, teamDescription: teamDesc, version: '1.0.0' }, null, 2)
      });

      // Update orchestrator with custom name and personality from wizard
      var orchName = document.getElementById('wiz-orch-name') ? document.getElementById('wiz-orch-name').value.trim() : '';
      var orchTraits = document.getElementById('wiz-orch-traits') ? document.getElementById('wiz-orch-traits').value.trim() : '';
      var orchTone = document.getElementById('wiz-orch-tone') ? document.getElementById('wiz-orch-tone').value.trim() : '';
      if (orchName) {
        await api.put('/api/agents/orchestrator', {
          name: orchName,
          personality: {
            traits: orchTraits.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
            tone: orchTone,
            style: 'clear, structured, action-oriented',
          },
        });
      }

      await api.post('/api/system/initialize', {});
      updateSidebarHeader(teamName);
      document.getElementById('wizard-overlay').classList.add('hidden');
      await loadSidebarAgents();
      navigate('chat');
      toast('Team setup complete! Use the Command Center to build your team.');
    } catch(e) {
      toast('Setup failed: ' + e.message, 'error');
      console.error(e);
    }
  }

  function updateSidebarHeader(teamName) {
    var header = document.getElementById('sidebar-header');
    header.innerHTML = '<h1>&#9881; ' + escHtml(teamName || 'Team') + '</h1><span class="subtitle">Agent Portal</span>';
  }

  // ── Round Table ────────────────────────────────────
  function runRoundTable() {
    navigate('chat');
    setTimeout(function() {
      if (termWs && termWs.readyState === 1) {
        var text = 'Run a round table\r';
        termWs.send(JSON.stringify({ type: 'input', data: text }));
      }
    }, 1000);
  }


  // ── Helpers ────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function linkifyText(text) {
    // Convert URLs to clickable links that open in new tab
    return text.replace(/(https?:\/\/[^\s<&]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>')
      .replace(/(data\/[^\s<&]+\.(md|txt|json|html|pdf|png|jpg|jpeg|gif|svg|mp4|csv))/gi, function(match) {
        return '<a href="#" onclick="App.viewFile(\'' + match.replace(/'/g, "\\'") + '\');return false;" style="color:var(--accent)">' + match + '</a>';
      });
  }

  // ── Init ───────────────────────────────────────────
  async function init() {
    connectWebSocket();

    // Ctrl+V paste image in Command Center
    document.addEventListener('paste', function(e) {
      if (state.currentView !== 'chat') return;
      var items = (e.clipboardData || {}).items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          e.preventDefault();
          pasteImage();
          return;
        }
      }
    });

    try {
      var sys = await api.get('/api/system/status');
      if (!sys.initialized) {
        document.getElementById('wizard-overlay').classList.remove('hidden');
        updateWizardStep();
      } else {
        updateSidebarHeader(sys.teamName);
        await loadSidebarAgents();
        navigate('chat');
        // Check for updates silently on startup
        silentUpdateCheck();
        // Re-check every 30 minutes
        setInterval(silentUpdateCheck, 30 * 60 * 1000);
      }
    } catch(e) {
      document.getElementById('wizard-overlay').classList.remove('hidden');
      updateWizardStep();
    }
  }

  // ── Public API ─────────────────────────────────────
  // ── Skills ───────────────────────────────────────
  var skillsInstalling = {};

  async function loadSkills() {
    try {
      var data = await api.get('/api/skills');
      renderSkills(data.skills || []);
    } catch(e) {
      console.error('Failed to load skills:', e);
      document.getElementById('skills-grid').innerHTML = '<div class="empty-state">Failed to load skills</div>';
    }
  }

  function renderSkills(skills) {
    var grid = document.getElementById('skills-grid');
    if (!skills.length) {
      grid.innerHTML = '<div class="empty-state">No skills available</div>';
      return;
    }
    grid.innerHTML = skills.map(function(s) {
      var installing = !!skillsInstalling[s.id];
      var statusText = installing ? 'Installing...' : (s.enabled ? 'Enabled' : 'Not installed');
      var statusClass = installing ? 'installing' : (s.enabled ? 'enabled' : '');
      var cardClass = s.enabled ? 'skill-card enabled' : 'skill-card';
      return '<div class="' + cardClass + '" data-skill-id="' + s.id + '">' +
        '<div class="skill-card-header">' +
          '<div class="skill-card-info">' +
            '<span class="skill-icon">' + (s.icon || '') + '</span>' +
            '<div><div class="skill-card-title">' + escHtml(s.name) + '</div></div>' +
          '</div>' +
          '<label class="toggle-switch">' +
            '<input type="checkbox" ' + (s.enabled ? 'checked' : '') + ' ' + (installing ? 'disabled' : '') +
            ' onchange="App.toggleSkill(' + q + s.id + q + ', this.checked)">' +
            '<span class="toggle-slider"></span>' +
          '</label>' +
        '</div>' +
        '<div class="skill-card-desc">' + escHtml(s.description) + '</div>' +
        (s.missingDeps && s.missingDeps.length && !s.enabled ?
          '<div class="skill-deps-warning">Requires: ' + s.missingDeps.join(', ') + ' (will auto-install)</div>' : '') +
        (s.settings && s.settings.length && s.enabled ? renderSkillSettings(s) : '') +
        '<div class="skill-card-footer">' +
          '<span class="skill-type-badge skill-type-' + s.type + '">' + s.type + '</span>' +
          '<span class="skill-status ' + statusClass + '">' + statusText + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderSkillSettings(skill) {
    var html = '<div class="skill-settings" data-skill="' + skill.id + '">';
    html += '<div class="skill-settings-title">Settings</div>';
    skill.settings.forEach(function(setting) {
      var val = skill.settingValues && skill.settingValues[setting.key] ? skill.settingValues[setting.key] : '';
      var inputType = setting.type === 'secret' ? 'password' : 'text';
      html += '<div class="skill-setting-row">';
      html += '<label>' + escHtml(setting.label) + (setting.required ? ' *' : '') + '</label>';
      html += '<input type="' + inputType + '" data-key="' + setting.key + '" value="' + escHtml(val) + '" placeholder="' + escHtml(setting.help || '') + '">';
      html += '</div>';
    });
    html += '<button class="btn btn-primary btn-sm" onclick="App.saveSkillSettings(' + q + skill.id + q + ')">Save Settings</button>';
    html += '</div>';
    return html;
  }

  async function saveSkillSettings(skillId) {
    var container = document.querySelector('.skill-settings[data-skill="' + skillId + '"]');
    if (!container) return;
    var inputs = container.querySelectorAll('input[data-key]');
    var settings = {};
    inputs.forEach(function(input) {
      if (input.value.trim()) settings[input.dataset.key] = input.value.trim();
    });
    try {
      await api.put('/api/skills/' + skillId + '/settings', settings);
      toast('Settings saved');
    } catch(e) {
      toast('Failed to save settings: ' + e.message, 'error');
    }
  }

  async function toggleSkill(skillId, enable) {
    var action = enable ? 'enable' : 'disable';
    if (enable) {
      skillsInstalling[skillId] = true;
      loadSkills();
    }
    try {
      var result = await api.post('/api/skills/' + skillId + '/' + action);
      delete skillsInstalling[skillId];
      if (result.ok) {
        toast(enable ? 'Skill enabled' : 'Skill disabled');
      } else {
        var errMsg = result.error || 'Failed to ' + action + ' skill';
        if (result.details) errMsg += '\n' + result.details;
        toast(errMsg, 'error');
        console.error('Skill ' + action + ' failed:', result);
      }
      loadSkills();
    } catch(e) {
      delete skillsInstalling[skillId];
      var msg = (e && e.body && e.body.error) ? e.body.error : (e && e.message) ? e.message : 'Failed to ' + action + ' skill';
      if (e && e.body && e.body.details) msg += '\n' + e.body.details;
      toast(msg, 'error');
      console.error('Skill ' + action + ' failed:', e && e.body ? e.body : e);
      loadSkills();
    }
  }

  // ── Autopilot ────────────────────────────────────────
  var autopilotEditId = null;

  async function loadAutopilot() {
    try {
      var schedules = await api.get('/api/autopilot');
      var agentsData = await api.get('/api/agents');
      var agentMap = {};
      (agentsData.agents || []).forEach(function(a) { agentMap[a.id] = a.name; });
      agentMap['orchestrator'] = agentMap['orchestrator'] || 'Orchestrator';

      var container = document.getElementById('autopilot-list');
      if (!container) return;
      if (!schedules || schedules.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:16px 0;font-size:13px">No autopilot schedules yet</div>';
        return;
      }

      var html = '<table class="autopilot-table"><thead><tr><th>Name</th><th>Agent</th><th>Interval</th><th>Last Run</th><th>Next Run</th><th>Controls</th></tr></thead><tbody>';
      schedules.forEach(function(s) {
        var agentName = agentMap[s.agentId] || s.agentId;
        var interval = formatInterval(s.intervalMinutes);
        var lastRun = s.lastRun ? new Date(s.lastRun).toLocaleString() : 'Never';
        var nextRun = s.enabled && s.nextRun ? new Date(s.nextRun).toLocaleString() : '-';
        var toggleIcon = s.enabled ? '\u23F8' : '\u25B6';
        var toggleTitle = s.enabled ? 'Pause' : 'Resume';
        var rowClass = s.enabled ? '' : ' class="ap-disabled"';
        html += '<tr' + rowClass + '>' +
          '<td>' + escHtml(s.name) + '</td>' +
          '<td>' + escHtml(agentName) + '</td>' +
          '<td>' + interval + '</td>' +
          '<td>' + lastRun + '</td>' +
          '<td>' + nextRun + '</td>' +
          '<td class="ap-controls">' +
            '<button class="btn-icon" title="' + toggleTitle + '" onclick="App.toggleAutopilot(\'' + s.id + '\',' + !s.enabled + ')">' + toggleIcon + '</button>' +
            '<button class="btn-icon" title="Edit" onclick="App.editAutopilot(\'' + s.id + '\')">&#9998;</button>' +
            '<button class="btn-icon" title="Delete" onclick="App.deleteAutopilot(\'' + s.id + '\')">&#10005;</button>' +
          '</td></tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch(e) { console.error('Failed to load autopilot:', e); }
  }

  function escHtml(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  function formatInterval(mins) {
    if (mins >= 1440 && mins % 1440 === 0) return (mins / 1440) + 'd';
    if (mins >= 60 && mins % 60 === 0) return (mins / 60) + 'h';
    return mins + 'm';
  }

  async function openAutopilotForm() {
    autopilotEditId = null;
    document.getElementById('ap-name').value = '';
    document.getElementById('ap-prompt').value = '';
    document.getElementById('ap-interval').value = '60';
    document.getElementById('ap-interval-unit').value = 'minutes';
    await populateAutopilotAgents();
    document.getElementById('autopilot-form').classList.remove('hidden');
  }

  function cancelAutopilotForm() {
    autopilotEditId = null;
    document.getElementById('autopilot-form').classList.add('hidden');
  }

  async function populateAutopilotAgents() {
    var sel = document.getElementById('ap-agent');
    sel.innerHTML = '';
    try {
      var data = await api.get('/api/agents');
      (data.agents || []).forEach(function(a) {
        var opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name + (a.isOrchestrator ? ' (Orchestrator)' : '');
        sel.appendChild(opt);
      });
    } catch(e) {}
  }

  async function saveAutopilot() {
    var name = document.getElementById('ap-name').value.trim();
    var prompt = document.getElementById('ap-prompt').value.trim();
    var agentId = document.getElementById('ap-agent').value;
    var intervalNum = parseInt(document.getElementById('ap-interval').value) || 1;
    var unit = document.getElementById('ap-interval-unit').value;

    if (!name || !prompt) { toast('Name and prompt are required', 'error'); return; }

    var intervalMinutes = intervalNum;
    if (unit === 'hours') intervalMinutes = intervalNum * 60;
    else if (unit === 'days') intervalMinutes = intervalNum * 1440;

    try {
      if (autopilotEditId) {
        await api.put('/api/autopilot/' + autopilotEditId, { name: name, prompt: prompt, agentId: agentId, intervalMinutes: intervalMinutes });
        toast('Schedule updated');
      } else {
        await api.post('/api/autopilot', { name: name, prompt: prompt, agentId: agentId, intervalMinutes: intervalMinutes });
        toast('Schedule created');
      }
      cancelAutopilotForm();
      loadAutopilot();
    } catch(e) { toast('Failed to save schedule', 'error'); }
  }

  async function toggleAutopilot(id, enabled) {
    try {
      await api.put('/api/autopilot/' + id, { enabled: enabled });
      loadAutopilot();
    } catch(e) { toast('Failed to update schedule', 'error'); }
  }

  async function editAutopilot(id) {
    try {
      var schedules = await api.get('/api/autopilot');
      var sched = schedules.find(function(s) { return s.id === id; });
      if (!sched) return;
      autopilotEditId = id;
      await populateAutopilotAgents();
      document.getElementById('ap-name').value = sched.name || '';
      document.getElementById('ap-prompt').value = sched.prompt || '';
      document.getElementById('ap-agent').value = sched.agentId || '';
      // Decompose intervalMinutes into value + unit
      var mins = sched.intervalMinutes;
      if (mins >= 1440 && mins % 1440 === 0) {
        document.getElementById('ap-interval').value = mins / 1440;
        document.getElementById('ap-interval-unit').value = 'days';
      } else if (mins >= 60 && mins % 60 === 0) {
        document.getElementById('ap-interval').value = mins / 60;
        document.getElementById('ap-interval-unit').value = 'hours';
      } else {
        document.getElementById('ap-interval').value = mins;
        document.getElementById('ap-interval-unit').value = 'minutes';
      }
      document.getElementById('autopilot-form').classList.remove('hidden');
    } catch(e) { toast('Failed to load schedule', 'error'); }
  }

  async function deleteAutopilot(id) {
    var ok = await confirmAction({
      title: 'Delete Schedule',
      message: 'Are you sure you want to delete this autopilot schedule?',
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      await api.del('/api/autopilot/' + id);
      toast('Schedule deleted');
      loadAutopilot();
    } catch(e) { toast('Failed to delete schedule', 'error'); }
  }

  // ── Help Section ─────────────────────────────────────
  var helpTopics = [
    {
      title: 'Getting Started',
      icon: '&#9733;',
      content: '<h2>Getting Started</h2>' +
        '<p>TeamHero is an AI agent team management platform that follows a <strong>scrum-like methodology</strong> with structured review sessions called <strong>Round Tables</strong>.</p>' +
        '<h3>How It Works</h3>' +
        '<p>The <strong>Orchestrator</strong> is the brain of your team. It manages all agents, delegates tasks, runs round tables, and serves as your main point of contact through the Command Center.</p>' +
        '<h3>Task Lifecycle</h3>' +
        '<ol>' +
        '<li><strong>Draft</strong> — Task is created but not yet reviewed</li>' +
        '<li><strong>Pending Approval</strong> — Agent submitted work for your review</li>' +
        '<li><strong>Approved</strong> — You approved the work; orchestrator will execute</li>' +
        '<li><strong>Improve</strong> — You requested revisions with feedback</li>' +
        '<li><strong>In Progress</strong> — Agent is actively working on it</li>' +
        '<li><strong>Done</strong> — Task is complete</li>' +
        '</ol>' +
        '<h3>Your Role as Owner</h3>' +
        '<p>You review and approve work, provide feedback, and guide the team through the Command Center. The orchestrator handles delegation and execution.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'chat\')">Go to Command Center &#8594;</button>'
    },
    {
      title: 'Round Tables',
      icon: '&#9679;',
      content: '<h2>Round Tables</h2>' +
        '<p>Round Tables are <strong>structured review sessions</strong>, similar to sprint reviews or standups in agile methodology. They give you a complete overview of your team' + q + 's progress.</p>' +
        '<h3>What Happens During a Round Table</h3>' +
        '<ul>' +
        '<li>The orchestrator scans <strong>all tasks</strong> and reviews each status</li>' +
        '<li>Agent progress is summarized — what' + q + 's done, what' + q + 's pending</li>' +
        '<li>All <strong>approved tasks are executed immediately</strong></li>' +
        '<li>Blockers and issues are flagged for your attention</li>' +
        '<li>The Knowledge Base is reviewed for stale or outdated documents</li>' +
        '</ul>' +
        '<h3>How to Trigger</h3>' +
        '<p>Open the Command Center and type: <code>Run a round table</code></p>' +
        '<p>You can also click the <strong>Run Round Table</strong> button on the Dashboard.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">Go to Dashboard &#8594;</button>'
    },
    {
      title: 'Agents',
      icon: '&#9632;',
      content: '<h2>Agents</h2>' +
        '<p>Agents are <strong>AI team members</strong>, each with a distinct role, personality, and set of capabilities. They execute tasks autonomously and submit work for your review.</p>' +
        '<h3>Agent Properties</h3>' +
        '<ul>' +
        '<li><strong>Role</strong> — Their job title and area of expertise</li>' +
        '<li><strong>Personality</strong> — Traits, tone, and communication style</li>' +
        '<li><strong>Rules</strong> — Guidelines specific to this agent</li>' +
        '<li><strong>Capabilities</strong> — Skills and tools they can use</li>' +
        '</ul>' +
        '<h3>Agent Memory</h3>' +
        '<p>Each agent has two memory banks:</p>' +
        '<ul>' +
        '<li><strong>Short Memory</strong> — Current context, recent tasks, and active work. Cleared after round tables.</li>' +
        '<li><strong>Long Memory</strong> — Persistent knowledge, preferences, and lessons learned.</li>' +
        '</ul>' +
        '<h3>Creating Agents</h3>' +
        '<p>Create agents through the dashboard or ask the orchestrator in the Command Center: <code>Build me a team with a Content Writer and a Researcher</code></p>' +
        '<button class="help-go-link" onclick="App.navigate(\'add-agent\')">Add New Agent &#8594;</button>'
    },
    {
      title: 'Tasks',
      icon: '&#9998;',
      content: '<h2>Tasks</h2>' +
        '<p>Tasks are <strong>work units</strong> assigned to agents. Each task tracks its status, version history, and feedback between you and the agent.</p>' +
        '<h3>Status Pipeline</h3>' +
        '<p>Click any status badge on a task to change it:</p>' +
        '<ul>' +
        '<li><strong>Draft</strong> — Created, awaiting initial work</li>' +
        '<li><strong>Pending Approval</strong> — Agent submitted deliverable for review</li>' +
        '<li><strong>Approved</strong> — You approved; orchestrator executes next steps</li>' +
        '<li><strong>Improve</strong> — Request revisions with specific feedback</li>' +
        '<li><strong>In Progress</strong> — Agent is actively working</li>' +
        '<li><strong>Done</strong> — Complete</li>' +
        '<li><strong>Hold</strong> — Paused, visible but not actively worked on</li>' +
        '<li><strong>Cancelled</strong> — Abandoned</li>' +
        '</ul>' +
        '<h3>Feedback &amp; Improve</h3>' +
        '<p>When reviewing a task, use the <strong>Improve</strong> action to send comments back to the agent. Comments are required — they tell the agent exactly what to change. Each revision creates a new version in the timeline.</p>' +
        '<h3>Versions</h3>' +
        '<p>Tasks track every submission as a version. You can see the full conversation history between you and the agent on the task detail page.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">View Tasks &#8594;</button>'
    },
    {
      title: 'Knowledge Base',
      icon: '&#9776;',
      content: '<h2>Knowledge Base</h2>' +
        '<p>The Knowledge Base is a <strong>library of research deliverables</strong> and reference documents created by your agents.</p>' +
        '<h3>How It Works</h3>' +
        '<ul>' +
        '<li>When a research task is completed, it can be <strong>promoted to the Knowledge Base</strong></li>' +
        '<li>Documents are categorized: Research, Analysis, Reference, or Guide</li>' +
        '<li>Tag documents for easy discovery and filtering</li>' +
        '</ul>' +
        '<h3>Promoting Tasks</h3>' +
        '<p>On any completed task, click the <strong>Promote to Knowledge Base</strong> button to save its deliverable as a knowledge document.</p>' +
        '<h3>Staleness</h3>' +
        '<p>Documents older than 30 days are flagged as stale during round tables for review or archival.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'knowledge\')">Go to Knowledge Base &#8594;</button>'
    },
    {
      title: 'Media Library',
      icon: '&#9634;',
      content: '<h2>Media Library</h2>' +
        '<p>The Media Library stores <strong>files, images, and documents</strong> associated with your team' + q + 's work.</p>' +
        '<h3>Features</h3>' +
        '<ul>' +
        '<li><strong>Thumbnails</strong> — Image files display visual previews</li>' +
        '<li><strong>Preview</strong> — Click any file to preview it in the browser</li>' +
        '<li><strong>Open in Folder</strong> — Quickly locate files on your system</li>' +
        '<li><strong>Filter</strong> — Browse by type: Images, Documents, Video, or All</li>' +
        '</ul>' +
        '<p>Files are stored in the <code>data/media/</code> folder in your project directory.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'media\')">Go to Media Library &#8594;</button>'
    },
    {
      title: 'Skills & Connectors',
      icon: '&#9670;',
      content: '<h2>Skills &amp; Connectors</h2>' +
        '<p>Skills are <strong>MCP (Model Context Protocol) integrations</strong> that give your agents the ability to interact with external tools and services.</p>' +
        '<h3>How Skills Work</h3>' +
        '<ul>' +
        '<li>Each skill installs its dependencies and configures the integration automatically</li>' +
        '<li>Enable or disable skills with a toggle switch</li>' +
        '<li>Some skills require configuration (API keys, workspace IDs, etc.)</li>' +
        '</ul>' +
        '<h3>Available Connectors</h3>' +
        '<p>Connectors include integrations like <strong>Trello</strong>, <strong>Gmail</strong>, <strong>Playwright</strong> (browser automation), and more. Check the Skills page for the full list of available integrations.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'skills\')">Go to Skills &#8594;</button>'
    },
    {
      title: 'Autopilot',
      icon: '&#9654;',
      content: '<h2>Autopilot</h2>' +
        '<p>Autopilot lets you <strong>schedule recurring tasks</strong> that run automatically on a set interval.</p>' +
        '<h3>How It Works</h3>' +
        '<ul>' +
        '<li>Create a schedule with a <strong>name</strong>, <strong>prompt</strong>, and <strong>interval</strong></li>' +
        '<li>Assign it to a specific agent or let the orchestrator decide</li>' +
        '<li>Set the interval in minutes, hours, or days</li>' +
        '<li>Enable or disable schedules with the play/pause controls</li>' +
        '</ul>' +
        '<h3>Use Cases</h3>' +
        '<ul>' +
        '<li>Daily standups or round tables</li>' +
        '<li>Periodic content generation</li>' +
        '<li>Scheduled research updates</li>' +
        '<li>Regular system health checks</li>' +
        '</ul>' +
        '<button class="help-go-link" onclick="App.navigate(\'settings\')">Go to Settings &#8594;</button>'
    },
    {
      title: 'Settings',
      icon: '&#9881;',
      content: '<h2>Settings</h2>' +
        '<p>Configure your TeamHero platform to match your workflow.</p>' +
        '<h3>Owner Profile</h3>' +
        '<p>Your profile tells agents about you — your name, role, expertise, and goals. Agents use this context to tailor their work.</p>' +
        '<h3>Team Rules &amp; Security Rules</h3>' +
        '<p>Define operational rules that apply to all agents, plus security guidelines for data protection and prompt injection prevention.</p>' +
        '<h3>Permission Modes</h3>' +
        '<ul>' +
        '<li><strong>Autonomous</strong> — Claude operates freely, executing tasks without confirmation prompts</li>' +
        '<li><strong>Supervised</strong> — Claude asks for confirmation before executing certain actions</li>' +
        '</ul>' +
        '<h3>Secrets &amp; API Keys</h3>' +
        '<p>Store encrypted secrets (API keys, tokens) that are injected into Claude sessions. Protected with AES-256-GCM encryption and a master password.</p>' +
        '<h3>Software Updates</h3>' +
        '<p>Check for platform updates from GitHub. Updates only affect platform files — your agents, tasks, and data are never changed.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'settings\')">Go to Settings &#8594;</button>'
    },
    {
      title: 'Command Center',
      icon: '&#9654;',
      content: '<h2>Command Center</h2>' +
        '<p>The Command Center is your <strong>terminal interface</strong> to the orchestrator. It' + q + 's where you give instructions, ask questions, and manage your team.</p>' +
        '<h3>Common Commands</h3>' +
        '<ul>' +
        '<li><code>Run a round table</code> — Trigger a structured team review</li>' +
        '<li><code>Create a task for [agent] to [description]</code> — Create and assign work</li>' +
        '<li><code>Build me a team with [roles]</code> — Create multiple agents at once</li>' +
        '<li><code>What is [agent] working on?</code> — Check agent status</li>' +
        '<li><code>Summarize all pending tasks</code> — Get an overview</li>' +
        '</ul>' +
        '<h3>Tips</h3>' +
        '<ul>' +
        '<li>Be specific about what you want — the orchestrator will delegate to the right agent</li>' +
        '<li>You can reference agents by name in your prompts</li>' +
        '<li>The orchestrator remembers context within a session</li>' +
        '</ul>' +
        '<button class="help-go-link" onclick="App.navigate(\'chat\')">Go to Command Center &#8594;</button>'
    }
  ];

  function loadHelp(topicIndex) {
    var idx = topicIndex || 0;
    var topicsEl = document.getElementById('help-topics');
    var contentEl = document.getElementById('help-content');
    if (!topicsEl || !contentEl) return;

    // Build topics list
    var html = '';
    for (var i = 0; i < helpTopics.length; i++) {
      html += '<div class="help-topic-item' + (i === idx ? ' active' : '') + '" onclick="App.selectHelpTopic(' + i + ')">' +
        '<span class="help-topic-icon">' + helpTopics[i].icon + '</span>' +
        helpTopics[i].title +
        '</div>';
    }
    topicsEl.innerHTML = html;

    // Load content
    contentEl.innerHTML = helpTopics[idx].content;
  }

  function selectHelpTopic(index) {
    var items = document.querySelectorAll('.help-topic-item');
    items.forEach(function(item, i) {
      item.classList.toggle('active', i === index);
    });
    var contentEl = document.getElementById('help-content');
    if (contentEl && helpTopics[index]) {
      contentEl.innerHTML = helpTopics[index].content;
      contentEl.scrollTop = 0;
    }
  }

  window.App = {
    navigate: navigate,
    wizardNext: wizardNext,
    wizardBack: wizardBack,
    wizardFinish: wizardFinish,
    selectTemplate: selectTemplate,
    saveAgent: saveAgent,
    editAgent: editAgent,
    deleteAgent: deleteAgent,
    clearShortMemory: clearShortMemory,
    toggleMemoryEdit: toggleMemoryEdit,
    saveMemory: saveMemory,
    switchAgentTab: switchAgentTab,
    openTask: openTask,
    reviewTask: reviewTask,
    navigateBack: navigateBack,
    filterTasks: filterTasks,
    openAddTask: openAddTask,
    closeAddTask: closeAddTask,
    submitAddTask: submitAddTask,
    state: state,
    filterMedia: filterMedia,
    openMediaPreview: openMediaPreview,
    closeMediaPreview: closeMediaPreview,
    openMediaFolder: openMediaFolder,
    saveProfile: saveProfile,
    saveRules: saveRules,
    rebuildContext: rebuildContext,
    resetSystem: resetSystem,
    resetAgents: resetAgents,
    runRoundTable: runRoundTable,
    restartTerminal: restartTerminal,
    savePermissionMode: savePermissionMode,
    unlockSecrets: unlockSecrets,
    lockSecrets: lockSecrets,
    initializeSecrets: initializeSecrets,
    showAddSecret: showAddSecret,
    cancelAddSecret: cancelAddSecret,
    saveSecret: saveSecret,
    editSecret: editSecret,
    deleteSecret: deleteSecret,
    changeSecretsPassword: changeSecretsPassword,
    checkForUpdates: checkForUpdates,
    performUpgrade: performUpgrade,
    checkClaudeStatus: checkClaudeStatus,
    toggleSkill: toggleSkill,
    saveSkillSettings: saveSkillSettings,
    viewVersionFile: viewVersionFile,
    viewFile: viewFile,
    changeTaskStatus: changeTaskStatus,
    toggleFeedback: toggleFeedback,
    pasteImage: pasteImage,
    focusTerminal: function() { if (terminal) { terminal.scrollToBottom(); terminal.focus(); } },
    attachTaskImage: attachTaskImage,
    promoteToKnowledge: promoteToKnowledge,
    filterKnowledge: filterKnowledge,
    openKnowledgeDoc: openKnowledgeDoc,
    deleteKnowledgeDoc: deleteKnowledgeDoc,
    cleanupTemp: cleanupTemp,
    loadTempStatus: loadTempStatus,
    openAutopilotForm: openAutopilotForm,
    cancelAutopilotForm: cancelAutopilotForm,
    saveAutopilot: saveAutopilot,
    toggleAutopilot: toggleAutopilot,
    editAutopilot: editAutopilot,
    deleteAutopilot: deleteAutopilot,
    selectHelpTopic: selectHelpTopic,
  };

  init();
})();
