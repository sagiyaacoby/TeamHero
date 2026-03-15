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
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
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
      setTimeout(function() { document.getElementById('chat-input').focus(); }, 100);
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
  var chatBusy = false;
  var currentAssistantEl = null;
  var assistantRendered = false;

  function connectWebSocket() {
    if (globalWs && globalWs.readyState <= 1) return;

    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.host + '/ws';
    globalWs = new WebSocket(wsUrl);

    globalWs.onopen = function() {
      setChatStatus('connected');
      clearTimeout(wsReconnectTimer);
    };

    globalWs.onmessage = function(evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'refresh') {
          handleRefresh(data.scope);
        } else {
          handleChatMessage(data);
        }
      } catch(e) {
        console.error('WS parse error:', e);
      }
    };

    globalWs.onclose = function(evt) {
      setChatStatus('disconnected');
      chatBusy = false;
      updateSendButton();
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    globalWs.onerror = function(evt) {
      setChatStatus('disconnected');
    };
  }

  // ── Live Refresh Handler ───────────────────────────
  function handleRefresh(scope) {
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
  }

  // ── Sidebar Agents ─────────────────────────────────
  async function loadSidebarAgents() {
    try {
      const data = await api.get('/api/agents');
      state.agents = data.agents || [];
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

    var html = '';

    orchAgents.forEach(function(a) {
      var isActive = state.currentView === 'agent-detail' && state.currentAgentId === a.id;
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link nav-orchestrator' + (isActive ? ' active' : '') + '">' +
        '<span class="icon">&#9733;</span> ' + escHtml(a.name) + '</a>';
    });

    subAgents.forEach(function(a) {
      var isActive = state.currentView === 'agent-detail' && state.currentAgentId === a.id;
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link' + (isActive ? ' active' : '') + '">' +
        '<span class="icon">&#9670;</span> ' + escHtml(a.name) + '</a>';
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
      var pending = 0, active = 0, done = 0;
      state.tasks.forEach(function(t) {
        if (t.status === 'pending_approval') pending++;
        else if (t.status === 'in_progress' || t.status === 'draft') active++;
        else if (t.status === 'done') done++;
      });
      document.getElementById('stat-pending').textContent = pending;
      document.getElementById('stat-active-tasks').textContent = active;
      document.getElementById('stat-done').textContent = done;

      // Fetch full task details for priority sorting
      var fullTasks = await Promise.all(state.tasks.map(function(t) {
        return api.get('/api/tasks/' + t.id).catch(function() { return Object.assign({priority:'medium'}, t); });
      }));

      var statusOrder = { pending_approval: 0, in_progress: 1, draft: 2, approved: 3, revision_needed: 4, done: 5 };
      fullTasks.sort(function(a, b) {
        var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9;
        var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9;
        if (sa !== sb) return sa - sb;
        var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 2;
        var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 2;
        if (pa !== pb) return pa - pb;
        return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
      });

      var dashEl = document.getElementById('dashboard-tasks');
      if (fullTasks.length === 0) {
        dashEl.innerHTML = '<div class="empty-state">No tasks yet</div>';
      } else {
        dashEl.innerHTML = fullTasks.map(function(t) {
          var statusClass = 'badge-' + (t.status || 'draft');
          var priorityClass = 'badge-' + (t.priority || 'medium');
          return '<div class="task-item" onclick="App.openTask(' + q + t.id + q + ')"><span class="task-title">' + escHtml(t.title) + '</span><span class="task-meta"><span class="badge ' + priorityClass + '">' + escHtml(t.priority || 'medium') + '</span><span class="badge ' + statusClass + '">' + escHtml(t.status || 'draft') + '</span>' + (t.assignedTo ? '<span>' + escHtml(t.assignedTo) + '</span>' : '') + '</span></div>';
        }).join('');
      }

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
      el.innerHTML = '<pre class="memory-content">' + escHtml(data.content || 'Empty') + '</pre>';
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
        var agentTasks = (tasksData.tasks || []).filter(function(t) { return t.assignedTo === agent.name; });
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
    var listEl = document.getElementById('agent-tasks-list');
    if (!summaryEl || !listEl) return;

    var pending = 0, active = 0, done = 0;
    tasks.forEach(function(t) {
      if (t.status === 'pending_approval') pending++;
      else if (t.status === 'in_progress' || t.status === 'draft') active++;
      else if (t.status === 'done') done++;
    });
    summaryEl.innerHTML = '<span class="badge badge-pending_approval">' + pending + ' Pending</span> ' +
      '<span class="badge badge-in_progress">' + active + ' Active</span> ' +
      '<span class="badge badge-done">' + done + ' Done</span>';

    var statusOrder = { pending_approval: 0, in_progress: 1, draft: 2, revision_needed: 3, approved: 4, done: 5 };
    tasks.sort(function(a, b) {
      var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9;
      var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9;
      if (sa !== sb) return sa - sb;
      var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 2;
      var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 2;
      return pa - pb;
    });

    if (tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No tasks assigned</div>';
      return;
    }

    listEl.innerHTML = tasks.map(function(t) {
      var statusClass = 'badge-' + (t.status || 'draft');
      var priorityClass = 'badge-' + (t.priority || 'medium');
      return '<div class="task-item" onclick="App.openTask(' + q + t.id + q + ')">' +
        '<span class="task-title">' + escHtml(t.title) + '</span>' +
        '<span class="task-meta">' +
          '<span class="badge ' + priorityClass + '">' + escHtml(t.priority || 'medium') + '</span>' +
          '<span class="badge ' + statusClass + '">' + escHtml(t.status || 'draft') + '</span>' +
        '</span></div>';
    }).join('');
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
      statusEl.textContent = task.status || 'draft';
      statusEl.className = 'badge badge-' + (task.status || 'draft');

      var priorityEl = document.getElementById('task-detail-priority');
      priorityEl.textContent = task.priority || 'medium';
      priorityEl.className = 'badge badge-' + (task.priority || 'medium');

      document.getElementById('task-detail-agent').textContent = task.assignedTo || 'Unassigned';
      document.getElementById('task-detail-date').textContent = task.updatedAt || task.createdAt || '-';

      // Load version dirs
      var versionText = '-';
      try {
        var dirs = await api.get('/api/ls/data/tasks/' + id);
        var versionDirs = dirs.filter(function(d) { return d.isDir && /^v\d+$/.test(d.name); });
        if (versionDirs.length > 0) {
          versionDirs.sort(function(a, b) { return b.name.localeCompare(a.name); });
          versionText = versionDirs[0].name + ' (' + versionDirs.length + ' versions)';
        }
      } catch(ve) {}
      document.getElementById('task-detail-version').textContent = versionText;

      document.getElementById('task-detail-desc').textContent = task.description || 'No description.';

      // Action buttons based on status
      var actionsEl = document.getElementById('task-detail-actions');
      if (actionsEl) {
        if (task.status === 'pending_approval') {
          actionsEl.innerHTML = '<button class="btn btn-primary" onclick="App.approveTask(' + q + id + q + ')">Approve</button> ' +
            '<button class="btn btn-secondary" onclick="App.requestRevision(' + q + id + q + ')">Request Revision</button>';
        } else if (task.status === 'approved') {
          actionsEl.innerHTML = '<button class="btn btn-primary" onclick="App.markTaskDone(' + q + id + q + ')">Mark Done</button>';
        } else {
          actionsEl.innerHTML = '';
        }
      }

      navigate('task-detail');
    } catch(e) {
      console.error('Failed to load task:', e);
      toast('Failed to load task', 'error');
    }
  }

  async function approveTask(id) {
    try {
      await api.put('/api/tasks/' + id, { status: 'approved' });
      toast('Task approved');
      navigateBack();
    } catch(e) { toast('Failed to approve task', 'error'); }
  }

  async function requestRevision(id) {
    try {
      await api.put('/api/tasks/' + id, { status: 'revision_needed' });
      toast('Revision requested');
      navigateBack();
    } catch(e) { toast('Failed to request revision', 'error'); }
  }

  async function markTaskDone(id) {
    try {
      await api.put('/api/tasks/' + id, { status: 'done' });
      toast('Task marked done');
      navigateBack();
    } catch(e) { toast('Failed to mark task done', 'error'); }
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
    if (!confirm('Delete this agent? This cannot be undone.')) return;
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
    try {
      await api.put('/api/agents/' + state.currentAgentId + '/memory/short', { content: '' });
      document.getElementById('agent-detail-short-mem').textContent = 'Empty';
      toast('Short memory cleared');
    } catch(e) { toast('Failed to clear memory', 'error'); }
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
    checkForUpdates();
  }

  async function rebuildContext() {
    try {
      await api.post('/api/rebuild-context', {});
      toast('CLAUDE.md rebuilt');
    } catch(e) { toast('Failed to rebuild context', 'error'); }
  }

  async function resetSystem() {
    if (!confirm('This will reset the initialized flag. You will see the setup wizard on next load. Continue?')) return;
    try {
      await api.post('/api/write-file', { path: 'config/system.json', content: JSON.stringify({ initialized: false, teamName: '', teamDescription: '', version: '1.0.0' }, null, 2) });
      toast('System reset. Reload the page to see the wizard.');
    } catch(e) { toast('Failed to reset', 'error'); }
  }

  async function resetAgents() {
    if (!confirm('This will delete ALL sub-agents (keeping the orchestrator). Continue?')) return;
    try {
      await api.post('/api/agents/reset', {});
      await loadSidebarAgents();
      toast('All sub-agents deleted. Orchestrator remains.');
      if (state.currentView === 'agent-detail') navigate('dashboard');
    } catch(e) { toast('Failed to reset agents', 'error'); }
  }

  // ── Software Updates ─────────────────────────────────
  async function checkForUpdates() {
    var statusEl = document.getElementById('update-status');
    var currentEl = document.getElementById('update-current-version');
    var latestEl = document.getElementById('update-latest-version');
    var changesEl = document.getElementById('update-changes');
    var upgradeBtn = document.getElementById('update-upgrade-btn');
    var banner = document.getElementById('update-banner');
    var repoEl = document.getElementById('update-repo-url');

    if (statusEl) { statusEl.textContent = 'Checking...'; statusEl.className = 'badge badge-inactive'; }

    try {
      var result = await api.get('/api/updates/check');

      if (currentEl) currentEl.textContent = result.currentVersion || '-';
      if (latestEl) latestEl.textContent = result.latestVersion || '-';
      if (repoEl && result.remoteUrl) {
        var displayUrl = result.remoteUrl.replace(/\.git$/, '');
        repoEl.href = displayUrl;
        repoEl.textContent = displayUrl.replace(/^https?:\/\//, '');
      } else if (repoEl && result.error) {
        repoEl.href = '#';
        repoEl.textContent = 'Not configured';
      }

      if (result.error) {
        if (statusEl) { statusEl.textContent = 'No remote'; statusEl.className = 'badge badge-inactive'; }
        if (changesEl) { changesEl.textContent = result.error; changesEl.classList.remove('hidden'); }
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        return;
      }

      if (result.updateAvailable) {
        if (statusEl) { statusEl.textContent = 'Update available'; statusEl.className = 'badge badge-pending'; }
        if (upgradeBtn) upgradeBtn.classList.remove('hidden');
        if (banner) banner.classList.remove('hidden');
        if (changesEl && result.changes && result.changes.length > 0) {
          changesEl.innerHTML = '<strong style="color:var(--text)">Changes:</strong><br>' +
            result.changes.map(function(c) { return escHtml(c); }).join('<br>');
          changesEl.classList.remove('hidden');
        }
        toast('Update available!');
      } else {
        if (statusEl) { statusEl.textContent = 'Up to date'; statusEl.className = 'badge badge-active'; }
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        if (changesEl) changesEl.classList.add('hidden');
        toast('You are up to date');
      }
    } catch(e) {
      if (statusEl) { statusEl.textContent = 'Error'; statusEl.className = 'badge badge-inactive'; }
      console.error('Update check failed:', e);
    }
  }

  async function performUpgrade() {
    if (!confirm('Upgrade the platform? This will update server and dashboard files only — your agents, tasks, and project data will NOT be changed. The server will need a restart after upgrading.')) return;

    try {
      var result = await api.post('/api/updates/upgrade', {});
      if (result.success) {
        toast('Upgrade complete! Restart the server to apply.');
        var statusEl = document.getElementById('update-status');
        if (statusEl) { statusEl.textContent = 'Restart required'; statusEl.className = 'badge badge-pending'; }
        var upgradeBtn = document.getElementById('update-upgrade-btn');
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        var banner = document.getElementById('update-banner');
        if (banner) banner.classList.add('hidden');
      } else {
        toast(result.message || 'Upgrade failed', 'error');
      }
    } catch(e) {
      toast('Upgrade failed', 'error');
      console.error('Upgrade error:', e);
    }
  }

  // Silent update check (no toast on "up to date")
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
  async function loadMedia() {
    try {
      var files = await api.get('/api/ls/data/media');
      var el = document.getElementById('media-grid');
      var mediaFiles = files.filter(function(f) { return !f.isDir; });
      if (state.mediaFilter && state.mediaFilter !== 'all') {
        var extMap = {
          image: ['png','jpg','jpeg','gif','svg','webp'],
          video: ['mp4','webm','mov','avi'],
          document: ['pdf','doc','docx','txt','md','csv','xls','xlsx']
        };
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
        var isImage = ['png','jpg','jpeg','gif','svg','webp'].indexOf(ext) >= 0;
        if (isImage) {
          return '<div class="media-item"><img src="/api/file/data/media/' + encodeURIComponent(f.name) + '" alt="' + escHtml(f.name) + '" style="width:100%;border-radius:6px"><p style="font-size:12px;color:var(--text-muted);margin-top:4px">' + escHtml(f.name) + '</p></div>';
        }
        return '<div class="media-item" style="padding:20px;text-align:center;background:var(--bg-surface);border-radius:6px"><p>' + escHtml(f.name) + '</p></div>';
      }).join('');
    } catch(e) {
      document.getElementById('media-grid').innerHTML = '<div class="empty-state">No media files yet</div>';
    }
  }

  // ── Chat / Command Center ──────────────────────────
  function setChatStatus(status) {
    var el = document.getElementById('chat-status');
    if (!el) return;
    el.className = 'chat-status ' + status;
    el.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
  }

  function sendChat() {
    var input = document.getElementById('chat-input');
    var text = input.value.trim();
    if (!text || chatBusy) return;
    if (!globalWs || globalWs.readyState !== 1) {
      toast('Not connected. Reconnecting...', 'error');
      connectWebSocket();
      return;
    }

    appendChatMsg('user', text);
    input.value = '';
    autoResizeInput();

    globalWs.send(JSON.stringify({ type: 'chat', content: text }));
    chatBusy = true;
    currentAssistantEl = null;
    assistantRendered = false;
    updateSendButton();
    showTypingIndicator();
  }

  function handleChatMessage(data) {
    if (data.type === 'claude-event') {
      hideTypingIndicator();
      var evt = data.event;

      if (evt.type === 'assistant') {
        var text = '';
        if (evt.message && evt.message.content) {
          evt.message.content.forEach(function(block) {
            if (block.type === 'text') text += block.text;
          });
        }
        if (text) {
          appendChatMsg('assistant', text);
          assistantRendered = true;
        }
      } else if (evt.type === 'result') {
        // Skip result rendering if already rendered via assistant or streaming
        if (!assistantRendered) {
          var text = '';
          if (evt.result) text = evt.result;
          if (evt.content) text = evt.content;
          if (typeof text === 'string' && text) {
            appendChatMsg('assistant', text);
          } else if (Array.isArray(text)) {
            text.forEach(function(block) {
              if (block.type === 'text' && block.text) appendChatMsg('assistant', block.text);
            });
          }
        }
      } else if (evt.type === 'content_block_delta' || evt.type === 'content_block_start') {
        var delta = '';
        if (evt.delta && evt.delta.text) delta = evt.delta.text;
        if (evt.content_block && evt.content_block.text) delta = evt.content_block.text;
        if (delta) {
          appendStreamDelta(delta);
          assistantRendered = true;
        }
      } else if (evt.type === 'tool_use' || (evt.type === 'assistant' && evt.message && evt.message.content && evt.message.content.some(function(b) { return b.type === 'tool_use'; }))) {
        var tools = [];
        if (evt.type === 'tool_use') {
          tools.push(evt);
        } else if (evt.message && evt.message.content) {
          tools = evt.message.content.filter(function(b) { return b.type === 'tool_use'; });
        }
        tools.forEach(function(tool) {
          appendToolUse(tool.name || 'tool', JSON.stringify(tool.input || {}, null, 2));
        });
      } else if (evt.type === 'raw' && evt.text) {
        appendChatMsg('assistant', evt.text);
        assistantRendered = true;
      }
    } else if (data.type === 'claude-error') {
      hideTypingIndicator();
      appendChatMsg('error', data.error);
    } else if (data.type === 'claude-done') {
      hideTypingIndicator();
      chatBusy = false;
      currentAssistantEl = null;
      assistantRendered = false;
      updateSendButton();
    }
  }

  function appendChatMsg(role, text) {
    var container = document.getElementById('chat-messages');
    var welcome = container.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    var div = document.createElement('div');
    div.className = 'chat-msg chat-msg-' + role;

    var label = document.createElement('div');
    label.className = 'chat-msg-role';
    label.textContent = role === 'user' ? 'You' : role === 'error' ? 'Error' : 'Orchestrator';
    div.appendChild(label);

    var content = document.createElement('div');
    content.className = 'chat-msg-content';
    content.textContent = text;
    div.appendChild(content);

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function appendStreamDelta(text) {
    if (!currentAssistantEl) {
      var container = document.getElementById('chat-messages');
      var welcome = container.querySelector('.chat-welcome');
      if (welcome) welcome.remove();

      var div = document.createElement('div');
      div.className = 'chat-msg chat-msg-assistant';

      var label = document.createElement('div');
      label.className = 'chat-msg-role';
      label.textContent = 'Orchestrator';
      div.appendChild(label);

      var content = document.createElement('div');
      content.className = 'chat-msg-content';
      div.appendChild(content);

      container.appendChild(div);
      currentAssistantEl = content;
    }
    currentAssistantEl.textContent += text;
    var container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  function appendToolUse(name, input) {
    var container = document.getElementById('chat-messages');
    var details = document.createElement('details');
    details.className = 'chat-tool-use';
    var summary = document.createElement('summary');
    summary.textContent = 'Tool: ' + name;
    details.appendChild(summary);
    var pre = document.createElement('pre');
    pre.textContent = input;
    details.appendChild(pre);
    container.appendChild(details);
    container.scrollTop = container.scrollHeight;
  }

  function showTypingIndicator() {
    var container = document.getElementById('chat-messages');
    if (container.querySelector('.chat-typing')) return;
    var div = document.createElement('div');
    div.className = 'chat-typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function hideTypingIndicator() {
    var el = document.querySelector('.chat-typing');
    if (el) el.remove();
  }

  function updateSendButton() {
    var btn = document.getElementById('chat-send-btn');
    if (!btn) return;
    btn.disabled = chatBusy;
    btn.textContent = chatBusy ? 'Stop' : 'Send';
    if (chatBusy) {
      btn.onclick = function() {
        if (globalWs && globalWs.readyState === 1) {
          globalWs.send(JSON.stringify({ type: 'stop' }));
        }
        chatBusy = false;
        hideTypingIndicator();
        updateSendButton();
      };
    } else {
      btn.onclick = sendChat;
    }
  }

  function clearChat() {
    var container = document.getElementById('chat-messages');
    container.innerHTML = '<div class="chat-welcome"><div class="chat-welcome-icon">&#9733;</div><h3>Command Center</h3><p>Chat with your orchestrator. Messages are processed by Claude CLI with full access to your team context.</p></div>';
    currentAssistantEl = null;
  }

  function chatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatBusy) return;
      sendChat();
    }
  }

  function autoResizeInput() {
    var el = document.getElementById('chat-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }

  document.addEventListener('input', function(e) {
    if (e.target.id === 'chat-input') autoResizeInput();
  });

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
      var input = document.getElementById('chat-input');
      input.value = 'Run a round table';
      sendChat();
    }, 500);
  }

  // ── Helpers ────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ───────────────────────────────────────────
  async function init() {
    connectWebSocket();

    try {
      var sys = await api.get('/api/system/status');
      if (!sys.initialized) {
        document.getElementById('wizard-overlay').classList.remove('hidden');
        updateWizardStep();
      } else {
        updateSidebarHeader(sys.teamName);
        await loadSidebarAgents();
        navigate('dashboard');
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
    switchAgentTab: switchAgentTab,
    openTask: openTask,
    approveTask: approveTask,
    requestRevision: requestRevision,
    markTaskDone: markTaskDone,
    navigateBack: navigateBack,
    filterMedia: filterMedia,
    saveProfile: saveProfile,
    saveRules: saveRules,
    rebuildContext: rebuildContext,
    resetSystem: resetSystem,
    resetAgents: resetAgents,
    runRoundTable: runRoundTable,
    sendChat: sendChat,
    clearChat: clearChat,
    chatKeydown: chatKeydown,
    checkClaudeStatus: checkClaudeStatus,
    checkForUpdates: checkForUpdates,
    performUpgrade: performUpgrade,
  };

  init();
})();
