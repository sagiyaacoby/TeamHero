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
    dashboardViewMode: 'hierarchy',
    agentViewMode: 'hierarchy',
    hierarchyExpanded: {},
    flowExpanded: {},
    dashboardSort: JSON.parse(localStorage.getItem('dashboardSort') || '{"new":true,"priority":false}'),
    agentSort: JSON.parse(localStorage.getItem('agentSort') || '{"new":true,"priority":false}'),
    dashboardAgentFilter: null,
    agentAgentFilter: null,
    tagsVisible: localStorage.getItem('tagsVisible') !== 'false',
    tagFilterExpanded: false,
  };

  var PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
  var q = String.fromCharCode(39);

  function timeAgo(dateString) {
    if (!dateString) return '';
    var diff = Date.now() - new Date(dateString).getTime();
    if (diff < 0) return 'just now';
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    var months = Math.floor(days / 30);
    return months + 'mo ago';
  }

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
    // opts: { title, message, confirmLabel, requireText, variant, onConfirm }
    // variant: 'neutral' hides warning icon and uses neutral button style
    return new Promise(function(resolve) {
      var overlay = document.getElementById('confirm-modal');
      var titleEl = document.getElementById('confirm-title');
      var msgEl = document.getElementById('confirm-message');
      var iconEl = document.getElementById('confirm-icon');
      var inputWrap = document.getElementById('confirm-input-wrap');
      var inputEl = document.getElementById('confirm-input');
      var hintEl = document.getElementById('confirm-hint');
      var okBtn = document.getElementById('confirm-ok-btn');
      var cancelBtn = document.getElementById('confirm-cancel-btn');

      titleEl.textContent = opts.title || 'Are you sure?';
      msgEl.textContent = opts.message || '';
      okBtn.textContent = opts.confirmLabel || 'Delete';

      // Apply variant styling
      if (opts.variant === 'neutral') {
        iconEl.classList.add('hidden');
        okBtn.className = 'btn btn-primary';
      } else {
        iconEl.classList.remove('hidden');
        okBtn.className = 'btn btn-cancel';
      }

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
  var _skipHashUpdate = false;

  function _buildHash(viewId, agentId) {
    if (viewId === 'agent-detail' && agentId) return '#agent/' + agentId;
    if (viewId === 'task-detail' && state.currentTaskId) return '#task/' + state.currentTaskId;
    if (viewId === 'knowledge-detail' && state._currentKnowledgeId) return '#knowledge/' + state._currentKnowledgeId;
    if (viewId === 'add-agent') return '#add-agent';
    return '#' + viewId;
  }

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
      }, 100);
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
      if (viewId === 'autopilot') loadAutopilotPage();
    }

    // Update hash unless this navigation was triggered by hashchange
    if (!_skipHashUpdate) {
      var newHash = _buildHash(viewId, agentId);
      if (location.hash !== newHash) {
        _lastNavigatedHash = newHash;
        location.hash = newHash;
      }
    }
  }

  document.addEventListener('click', function(e) {
    // Handle sidebar agent arrow click
    var arrow = e.target.closest('.nav-agent-arrow');
    if (arrow) {
      e.preventDefault();
      e.stopPropagation();
      var agentId = arrow.dataset.agentId;
      if (!state.expandedAgents) state.expandedAgents = {};
      state.expandedAgents[agentId] = !state.expandedAgents[agentId];
      arrow.classList.toggle('expanded');
      var sub = document.querySelector('[data-agent-sub="' + agentId + '"]');
      if (sub) sub.classList.toggle('hidden');
      // Lazy-load file count on first expand
      if (state.expandedAgents[agentId] && (!state.agentFileCounts || state.agentFileCounts[agentId] == null)) {
        if (!state.agentFileCounts) state.agentFileCounts = {};
        api.get('/api/agents/' + agentId + '/files').then(function(data) {
          state.agentFileCounts[agentId] = data.totalFiles || 0;
          var badge = sub && sub.querySelector('.nav-badge-sm');
          if (badge) badge.textContent = state.agentFileCounts[agentId];
        }).catch(function() {});
      }
      return;
    }

    var link = e.target.closest('.nav-link');
    if (!link) return;
    e.preventDefault();
    var view = link.dataset.view;
    var agentId = link.dataset.agentId;
    if (view === 'agent-files' && agentId) {
      navigate('agent-detail', agentId);
      setTimeout(function() { switchAgentTab('files'); }, 50);
    } else if (agentId) {
      navigate('agent-detail', agentId);
    } else if (view) {
      navigate(view);
    }
  });

  // ── Hash Routing ───────────────────────────────────
  function _navigateFromHash() {
    var hash = location.hash || '';
    if (hash.charAt(0) === '#') hash = hash.substring(1);
    if (!hash) { navigate('chat'); return; }

    var parts = hash.split('/');
    var view = parts[0];
    var id = parts.slice(1).join('/');

    if (view === 'agent' && id) {
      navigate('agent-detail', id);
    } else if (view === 'agent-files' && id) {
      navigate('agent-detail', id);
      setTimeout(function() { switchAgentTab('files'); }, 50);
    } else if (view === 'task' && id) {
      openTask(id);
    } else if (view === 'knowledge' && id) {
      openKnowledgeDoc(id);
    } else {
      // Direct view names: dashboard, agents, settings, chat, etc.
      var el = document.getElementById('view-' + view);
      if (el) {
        navigate(view);
      } else {
        navigate('chat');
      }
    }
  }

  var _lastNavigatedHash = '';
  window.addEventListener('hashchange', function() {
    // Skip if this hashchange was triggered by our own navigate() call
    if (location.hash === _lastNavigatedHash) return;
    _skipHashUpdate = true;
    _navigateFromHash();
    _skipHashUpdate = false;
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
      // Refresh sidebar agents on reconnect to reset stale indicator state
      loadSidebarAgents();
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

  // ── Live Refresh Handler (throttled) ─────────────────
  var refreshTimer = null;
  var pendingRefreshScope = null;
  var lastRefreshTime = 0;
  var REFRESH_INTERVAL = 2000; // minimum ms between full view refreshes

  function handleRefresh(scope) {
    // Merge scopes - 'all' wins, otherwise accumulate as set
    if (pendingRefreshScope === 'all' || scope === 'all') {
      pendingRefreshScope = 'all';
    } else if (!pendingRefreshScope) {
      pendingRefreshScope = scope;
    } else if (pendingRefreshScope !== scope) {
      pendingRefreshScope = 'all';
    }
    // Task changes update sidebar dots immediately for real-time agent indicators
    if (scope === 'tasks' || scope === 'all') {
      loadSidebarAgents();
    }
    // Throttle: fire at most once per REFRESH_INTERVAL, but always fire eventually
    if (refreshTimer) return; // already scheduled
    var elapsed = Date.now() - lastRefreshTime;
    var delay = Math.max(0, REFRESH_INTERVAL - elapsed);
    refreshTimer = setTimeout(function() {
      lastRefreshTime = Date.now();
      doRefresh(pendingRefreshScope || 'all');
      pendingRefreshScope = null;
      refreshTimer = null;
    }, delay);
  }

  function doRefresh(scope) {
    // Always update sidebar (agents, pending badge, working indicators)
    loadSidebarAgents();
    // Skip full view refresh if user is on the Command Center - don't disrupt terminal
    if (state.currentView === 'chat') {
      if (terminal) terminal.focus();
      return;
    }
    var v = state.currentView;
    if (scope === 'all' || scope === 'agents' || scope === 'tasks') {
      if (v === 'dashboard') loadDashboard();
      if (v === 'agent-detail' && state.currentAgentId) loadAgentDetail(state.currentAgentId);
      if (v === 'task-detail' && state.currentTaskId) openTask(state.currentTaskId);
    }
    if (scope === 'all' || scope === 'agents') {
      if (v === 'settings') loadSettings();
    }
    if (scope === 'all' || scope === 'profile') {
      if (v === 'profile') loadProfileEditor();
    }
    if (scope === 'all' || scope === 'rules') {
      if (v === 'rules') loadRulesEditor();
    }
    if (scope === 'all' || scope === 'secrets') {
      if (v === 'settings') { loadSecretsStatus(); loadCredentialsStatus(); renderVaultStatusBar('vault-status-bar-secrets'); renderVaultStatusBar('vault-status-bar-passwords'); }
    }
    if (scope === 'all' || scope === 'skills') {
      if (v === 'skills') loadSkills();
    }
    if (scope === 'all' || scope === 'knowledge') {
      if (v === 'knowledge') loadKnowledge();
      if (v === 'knowledge-detail' && state._currentKnowledgeId) openKnowledgeDoc(state._currentKnowledgeId);
    }
    if (scope === 'all' || scope === 'autopilot' || scope === 'tasks') {
      if (v === 'autopilot') loadAutopilotPage();
    }
    if (scope === 'all') {
      if (v === 'media') loadMedia();
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
      var nameHtml = escHtml(a.name);
      if (a.role || a.mission) {
        nameHtml = '<span data-tooltip="' + escHtml((a.role || '') + (a.role && a.mission ? '\n' : '') + (a.mission || '')) + '">' + escHtml(a.name) + '</span>';
      }
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link nav-orchestrator' + (isActive ? ' active' : '') + '">' +
        '<span class="icon">&#9733;</span> ' + nameHtml + '<span class="' + dotClass + '" title="' + dotTitle + '"></span></a>';
    });

    subAgents.forEach(function(a) {
      var isActive = state.currentView === 'agent-detail' && state.currentAgentId === a.id;
      var dotClass = 'agent-dot' + (workingAgents[a.id] ? ' agent-dot-working' : '');
      var dotTitle = workingAgents[a.id] ? 'Working on task' : 'Idle';
      var nameHtml = escHtml(a.name);
      if (a.role || a.mission) {
        nameHtml = '<span data-tooltip="' + escHtml((a.role || '') + (a.role && a.mission ? '\n' : '') + (a.mission || '')) + '">' + escHtml(a.name) + '</span>';
      }
      var isExpanded = state.expandedAgents && state.expandedAgents[a.id];
      html += '<div class="nav-agent-group">';
      html += '<div class="nav-agent-row">';
      html += '<span class="nav-agent-arrow' + (isExpanded ? ' expanded' : '') + '" data-agent-id="' + a.id + '" title="Show files">&#9654;</span>';
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link' + (isActive ? ' active' : '') + '" style="flex:1">' +
        nameHtml + '<span class="' + dotClass + '" title="' + dotTitle + '"></span></a>';
      html += '</div>';
      var countText = state.agentFileCounts && state.agentFileCounts[a.id] != null ? state.agentFileCounts[a.id] : '-';
      html += '<div class="nav-agent-sub' + (isExpanded ? '' : ' hidden') + '" data-agent-sub="' + a.id + '">';
      html += '<a href="#" data-view="agent-files" data-agent-id="' + a.id + '" class="nav-link nav-sub-link">' +
        '<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span> Files <span class="nav-badge-sm">' + countText + '</span></a>';
      html += '</div>';
      html += '</div>';
    });

    container.innerHTML = html;

    // Hide "Add Agent" link until orchestrator exists
    var addAgentLink = document.querySelector('[data-view="add-agent"]');
    if (addAgentLink) {
      addAgentLink.closest('li').style.display = orchAgents.length > 0 ? '' : 'none';
    }

    // Update pending count badge on Dashboard nav
    var pendingCount = 0;
    (state.tasks || []).forEach(function(t) {
      if (t.status === 'pending_approval') pendingCount++;
    });
    var dashLink = document.querySelector('[data-view="dashboard"]');
    if (dashLink) {
      var badge = dashLink.querySelector('.nav-badge');
      if (pendingCount > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'nav-badge';
          dashLink.appendChild(badge);
        }
        badge.textContent = pendingCount;
      } else if (badge) {
        badge.remove();
      }
    }
    updateAutopilotBadge();
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
      var working = 0, pending = 0, accepted = 0, closed = 0;
      state.tasks.forEach(function(t) {
        // Pending counts ALL tasks (including subtasks) - owner must see everything needing review
        if (t.status === 'pending_approval') { pending++; return; }
        // Other stats count top-level only
        if (t.parentTaskId) return;
        if (t.status === 'in_progress' || t.status === 'planning' || t.status === 'revision_needed') working++;
        else if (t.status === 'accepted') accepted++;
        else if (t.status === 'closed' || t.status === 'done') closed++;
      });
      document.getElementById('stat-total').textContent = state.tasks.filter(function(t) { return !t.parentTaskId && t.status !== 'closed' && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'hold'; }).length;
      document.getElementById('stat-hold').textContent = state.tasks.filter(function(t) { return !t.parentTaskId && t.status === 'hold'; }).length;
      document.getElementById('stat-working').textContent = working;
      document.getElementById('stat-pending').textContent = pending;
      document.getElementById('stat-accepted').textContent = accepted;
      document.getElementById('stat-closed').textContent = closed;
      // Highlight active filter stat card
      document.querySelectorAll('.stat-card[data-filter]').forEach(function(card) {
        card.classList.toggle('stat-card-active', card.dataset.filter === state.dashboardTaskFilter);
      });

      // Fetch full task details for priority sorting
      var fullTasks = await Promise.all(state.tasks.map(function(t) {
        return api.get('/api/tasks/' + t.id).catch(function() { return Object.assign({priority:'medium'}, t); });
      }));

      state.cachedDashboardTasks = fullTasks;
      updateSortButtons('dashboard');
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
    // Invalidate files cache when switching agents
    if (agentFilesCache.agentId !== id) agentFilesCache = { agentId: null, data: null };
    // Reset files tab button text
    var filesBtn = document.querySelector('.tab-btn[data-tab="files"]');
    if (filesBtn) filesBtn.textContent = 'Files';
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

    var working = 0, pending = 0, accepted = 0, closed = 0, hold = 0;
    tasks.forEach(function(t) {
      if (t.status === 'in_progress' || t.status === 'planning' || t.status === 'revision_needed') working++;
      else if (t.status === 'pending_approval') pending++;
      else if (t.status === 'accepted') accepted++;
      else if (t.status === 'closed' || t.status === 'done') closed++;
      else if (t.status === 'hold') hold++;
    });
    var af = state.agentTaskFilter;
    var total = tasks.filter(function(t) { return t.status !== 'closed' && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'hold'; }).length;
    summaryEl.innerHTML =
      '<span class="badge badge-all clickable-badge' + (af === 'all' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'all\',\'agent\')">' + total + ' Active</span> ' +
      '<span class="badge badge-pending_approval clickable-badge' + (af === 'pending_approval' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'pending_approval\',\'agent\')">' + pending + ' Pending</span> ' +
      '<span class="badge badge-in_progress clickable-badge' + (af === 'in_progress' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'in_progress\',\'agent\')">' + working + ' Working</span> ' +
      '<span class="badge badge-accepted clickable-badge' + (af === 'accepted' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'accepted\',\'agent\')">' + accepted + ' Accepted</span> ' +
      '<span class="badge badge-hold clickable-badge' + (af === 'hold' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'hold\',\'agent\')">' + hold + ' Hold</span> ' +
      '<span class="badge badge-closed clickable-badge' + (af === 'closed' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'closed\',\'agent\')">' + closed + ' Closed</span>';

    state.cachedAgentTasks = tasks;
    updateSortButtons('agent');
    renderFilteredTasks('agent');
  }

  function getFilteredRootTasks(context) {
    var filter = context === 'dashboard' ? state.dashboardTaskFilter : state.agentTaskFilter;
    var tasks = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;

    var filtered;
    if (filter === 'all') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && t.status !== 'closed' && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'hold'; });
    } else if (filter === 'in_progress') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && (t.status === 'in_progress' || t.status === 'planning' || t.status === 'revision_needed'); });
    } else if (filter === 'closed') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && (t.status === 'closed' || t.status === 'done'); });
    } else if (filter === 'pending_approval') {
      // Pending shows ALL tasks needing review - including subtasks, since the owner must see them
      filtered = tasks.filter(function(t) { return t.status === 'pending_approval'; });
    } else {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && t.status === filter; });
    }

    // Apply agent filter
    var agentFilter = context === 'dashboard' ? state.dashboardAgentFilter : state.agentAgentFilter;
    if (agentFilter) {
      filtered = filtered.filter(function(t) { return t.assignedTo === agentFilter; });
    }

    // Apply tag filters (subtask-aware: if a subtask matches, include the parent)
    var tagFilters = context === 'dashboard' ? state.dashboardTagFilters : state.agentTagFilters;
    if (tagFilters && tagFilters.length > 0) {
      var allTasksForTags = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;
      filtered = filtered.filter(function(t) {
        var taskMatches = t.tags && t.tags.length > 0 && tagFilters.every(function(tf) {
          return t.tags.some(function(tag) { return tag.toLowerCase() === tf.toLowerCase(); });
        });
        if (taskMatches) return true;
        // Check if any subtask matches the tag filter
        var subs = allTasksForTags.filter(function(s) { return s.parentTaskId === t.id; });
        return subs.some(function(sub) {
          return sub.tags && sub.tags.length > 0 && tagFilters.every(function(tf) {
            return sub.tags.some(function(tag) { return tag.toLowerCase() === tf.toLowerCase(); });
          });
        });
      });
    }

    var sortState = context === 'dashboard' ? state.dashboardSort : state.agentSort;
    filtered.sort(function(a, b) {
      // Priority sort (if active): higher priority first
      if (sortState.priority) {
        var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 2;
        var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 2;
        if (pa !== pb) return pa - pb;
      }
      // New sort (if active): newest first by createdAt
      if (sortState['new']) {
        var da = a.createdAt || '';
        var db = b.createdAt || '';
        if (da !== db) return db.localeCompare(da);
      }
      return 0;
    });
    return filtered;
  }

  function isTaskBlocked(task, allTasks) {
    if (!task.dependsOn || task.dependsOn.length === 0) return false;
    return task.dependsOn.some(function(depId) {
      var dep = allTasks.find(function(t) { return t.id === depId; });
      return !dep || (dep.status !== 'accepted' && dep.status !== 'closed');
    });
  }

  function findSubtasks(parentId, allTasks) {
    return allTasks.filter(function(t) { return t.parentTaskId === parentId; });
  }

  function renderFilteredTasks(context) {
    var listEl = document.getElementById(context === 'dashboard' ? 'dashboard-tasks' : 'agent-tasks-list');
    if (!listEl) return;
    var viewMode = context === 'dashboard' ? state.dashboardViewMode : state.agentViewMode;
    var filtered = getFilteredRootTasks(context);

    if (filtered.length === 0) {
      var filter = context === 'dashboard' ? state.dashboardTaskFilter : state.agentTaskFilter;
      listEl.innerHTML = '<div class="empty-state">No ' + (filter === 'all' ? '' : filter.replace(/_/g, ' ') + ' ') + 'tasks</div>';
    } else if (viewMode === 'flow') {
      renderFlowView(listEl, filtered, context);
    } else {
      renderHierarchyView(listEl, filtered, context);
    }
    renderAgentFilterBar(context);
    renderTagFilterBar(context);
  }

  // ── Flow View (Node Graph) ─────────────────────────────────
  function renderFlowView(listEl, filtered, context) {
    var allTasks = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;
    var taskMap = {};
    allTasks.forEach(function(t) { taskMap[t.id] = t; });

    // Collect ALL nodes to render: parents + subtasks as separate nodes
    var nodes = []; // flat list of all tasks to render as nodes
    var edges = []; // {from, to, type} - 'parent' or 'dep'
    var nodeSet = {};

    function addNode(task) {
      if (nodeSet[task.id]) return;
      nodeSet[task.id] = true;
      nodes.push(task);
    }

    filtered.forEach(function(t) {
      addNode(t);
      // Add subtasks as separate nodes
      if (t.subtasks && t.subtasks.length > 0) {
        t.subtasks.forEach(function(sid) {
          var sub = taskMap[sid];
          if (sub) addNode(sub);
        });
      }
    });

    // Second pass: add parent->child edges only when child has no visible dependency edges
    nodes.forEach(function(t) {
      if (t.parentTaskId && nodeSet[t.parentTaskId]) {
        var childHasDeps = t.dependsOn && t.dependsOn.some(function(d) { return nodeSet[d]; });
        if (!childHasDeps) {
          edges.push({ from: t.parentTaskId, to: t.id, type: 'parent' });
        }
      }
    });

    // Third pass: add dependency edges for ALL nodes (root + subtasks)
    nodes.forEach(function(t) {
      if (t.dependsOn && t.dependsOn.length > 0) {
        t.dependsOn.forEach(function(depId) {
          if (nodeSet[depId]) edges.push({ from: depId, to: t.id, type: 'dep' });
        });
      }
    });

    // Layout: place parent nodes in column 0, their subtasks in column 1
    // Independent tasks (no parent, no children) go in column 0
    // Tasks with deps go in later columns
    var nodeW = 220, nodeH = 64, nodeGapX = 300, nodeGapY = 20, padX = 40, padY = 40;
    var nodePositions = {};

    // Assign columns: parents/independent at col 0, subtasks at col 1, dep chains push further
    var colMap = {};
    function getCol(id, visited) {
      if (colMap[id] !== undefined) return colMap[id];
      if (!visited) visited = {};
      if (visited[id]) return 0;
      visited[id] = true;
      var t = taskMap[id];
      if (!t) return 0;
      var col = 0;
      // If it's a subtask, place one column after parent
      if (t.parentTaskId && nodeSet[t.parentTaskId]) {
        col = Math.max(col, getCol(t.parentTaskId, visited) + 1);
      }
      // If it depends on other tasks, place after them
      if (t.dependsOn) {
        t.dependsOn.forEach(function(depId) {
          if (nodeSet[depId]) col = Math.max(col, getCol(depId, visited) + 1);
        });
      }
      colMap[id] = col;
      return col;
    }
    nodes.forEach(function(t) { getCol(t.id); });

    // Group into columns
    var maxCol = 0;
    nodes.forEach(function(t) { if (colMap[t.id] > maxCol) maxCol = colMap[t.id]; });
    var columns = [];
    for (var c = 0; c <= maxCol; c++) columns.push([]);
    nodes.forEach(function(t) { columns[colMap[t.id] || 0].push(t); });

    // Sort within columns: active statuses first
    var statusPriority = { in_progress: 0, revision_needed: 1, pending_approval: 2, planning: 3, accepted: 4, hold: 5, closed: 6, cancelled: 7 };
    columns.forEach(function(col) {
      col.sort(function(a, b) {
        var sa = statusPriority[a.status] !== undefined ? statusPriority[a.status] : 8;
        var sb = statusPriority[b.status] !== undefined ? statusPriority[b.status] : 8;
        return sa - sb;
      });
    });

    // Compute positions
    var canvasH = 0;
    columns.forEach(function(col, ci) {
      var x = padX + ci * nodeGapX;
      var y = padY;
      col.forEach(function(task) {
        nodePositions[task.id] = { x: x, y: y, w: nodeW, h: nodeH };
        y += nodeH + nodeGapY;
      });
      if (y > canvasH) canvasH = y;
    });
    canvasH = Math.max(canvasH + padY, 300);
    var canvasW = padX * 2 + (maxCol + 1) * nodeGapX;

    // Build HTML
    var html = '<div class="flow-canvas" id="flow-canvas-' + context + '" style="min-width:' + canvasW + 'px;min-height:' + canvasH + 'px;position:relative;">';

    // SVG layer for connections
    html += '<svg class="flow-svg" id="flow-svg-' + context + '" width="' + canvasW + '" height="' + canvasH + '">';
    html += '<defs>';
    html += '<marker id="dot-' + context + '" markerWidth="6" markerHeight="6" refX="3" refY="3">';
    html += '<circle cx="3" cy="3" r="2.5" fill="#262a30"/></marker>';
    html += '<marker id="dot-blocked-' + context + '" markerWidth="6" markerHeight="6" refX="3" refY="3">';
    html += '<circle cx="3" cy="3" r="2.5" fill="#e06060"/></marker>';
    html += '</defs>';

    // Draw edges
    edges.forEach(function(edge) {
      var sp = nodePositions[edge.from];
      var tp = nodePositions[edge.to];
      if (!sp || !tp) return;

      var x1 = sp.x + sp.w; // right edge of source
      var y1 = sp.y + sp.h / 2;
      var x2 = tp.x; // left edge of target
      var y2 = tp.y + tp.h / 2;

      // If target is in same or earlier column, route differently
      if (x2 <= x1) {
        x1 = sp.x + sp.w / 2;
        y1 = sp.y + sp.h;
        x2 = tp.x + tp.w / 2;
        y2 = tp.y;
      }

      var dx = Math.abs(x2 - x1) * 0.5;
      var cssClass, marker;
      if (edge.type === 'parent') {
        cssClass = 'flow-edge-parent';
        marker = 'url(#dot-' + context + ')';
      } else {
        var blocked = isTaskBlocked(taskMap[edge.to], allTasks);
        cssClass = blocked ? 'flow-edge-blocked' : 'flow-edge-dep';
        marker = blocked ? 'url(#dot-blocked-' + context + ')' : 'url(#dot-' + context + ')';
      }

      html += '<path class="' + cssClass + '" data-edge-from="' + edge.from + '" data-edge-to="' + edge.to + '" d="M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="' + marker + '"/>';
    });
    html += '</svg>';

    // Render nodes
    nodes.forEach(function(task) {
      var pos = nodePositions[task.id];
      if (!pos) return;
      html += renderFlowNode(task, allTasks, context, pos);
    });

    html += '</div>';
    listEl.innerHTML = '<div class="flow-view">' + html + '</div>';

    // ── Hover: highlight upstream & downstream dependency chain ──
    var flowContainer = listEl.querySelector('.flow-view');
    if (flowContainer) {
      // Build adjacency maps from edges
      var upstreamMap = {};   // id -> [ids that feed into it]
      var downstreamMap = {}; // id -> [ids that depend on it]
      edges.forEach(function(e) {
        if (!upstreamMap[e.to]) upstreamMap[e.to] = [];
        upstreamMap[e.to].push(e.from);
        if (!downstreamMap[e.from]) downstreamMap[e.from] = [];
        downstreamMap[e.from].push(e.to);
      });

      function collectChain(id, map, result) {
        var neighbors = map[id];
        if (!neighbors) return;
        neighbors.forEach(function(nid) {
          if (!result[nid]) {
            result[nid] = true;
            collectChain(nid, map, result);
          }
        });
      }

      flowContainer.querySelectorAll('.flow-node').forEach(function(nodeEl) {
        var tid = nodeEl.dataset.taskId;
        nodeEl.addEventListener('mouseenter', function() {
          var upstream = {}, downstream = {};
          collectChain(tid, upstreamMap, upstream);
          collectChain(tid, downstreamMap, downstream);
          var chain = Object.assign({}, upstream, downstream);
          // Highlight related nodes
          flowContainer.querySelectorAll('.flow-node').forEach(function(n) {
            if (n.dataset.taskId !== tid) {
              if (chain[n.dataset.taskId]) {
                n.classList.add('flow-chain-highlight');
              } else {
                n.classList.add('flow-chain-dim');
              }
            }
          });
          // Highlight related edges
          flowContainer.querySelectorAll('.flow-svg path').forEach(function(p) {
            var eFrom = p.getAttribute('data-edge-from');
            var eTo = p.getAttribute('data-edge-to');
            var inChain = (chain[eFrom] || eFrom === tid) && (chain[eTo] || eTo === tid);
            if (inChain) {
              p.classList.add('flow-edge-highlight');
            } else {
              p.classList.add('flow-edge-dim');
            }
          });
        });
        nodeEl.addEventListener('mouseleave', function() {
          flowContainer.querySelectorAll('.flow-chain-highlight, .flow-chain-dim').forEach(function(n) {
            n.classList.remove('flow-chain-highlight', 'flow-chain-dim');
          });
          flowContainer.querySelectorAll('.flow-edge-highlight, .flow-edge-dim').forEach(function(p) {
            p.classList.remove('flow-edge-highlight', 'flow-edge-dim');
          });
        });
      });
    }
  }

  function renderFlowNode(task, allTasks, context, pos) {
    var blocked = isTaskBlocked(task, allTasks);
    var hasBlocker = !!task.blocker;
    var statusClass = 'status-' + (task.status || 'planning');
    var blockedClass = blocked ? ' blocked' : '';
    var blockerClass = hasBlocker ? ' has-blocker' : '';
    var isChild = !!task.parentTaskId;
    var agentName = '';
    if (task.assignedTo) {
      var found = state.agents.find(function(a) { return a.id === task.assignedTo; });
      agentName = found ? found.name : '';
    }
    var statusLabel = STATUS_LABELS[task.status] || (task.status || 'planning').replace(/_/g, ' ');
    var hasOut = task.subtasks && task.subtasks.length > 0;
    var hasIn = isChild || (task.dependsOn && task.dependsOn.length > 0);

    var html = '<div class="flow-node ' + statusClass + blockedClass + blockerClass + (isChild ? ' flow-child' : '') + '" data-task-id="' + task.id + '" ';
    html += 'style="position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + pos.w + 'px;height:' + pos.h + 'px;" ';
    html += 'onclick="App.openTask(\'' + task.id + '\')">';

    // Connection ports
    if (hasIn) html += '<div class="flow-port flow-port-in"></div>';
    if (hasOut) html += '<div class="flow-port flow-port-out"></div>';

    html += '<div class="flow-node-title">' + escHtml(task.title) + '</div>';
    html += '<div class="flow-node-meta">';
    html += '<span class="flow-node-status badge badge-' + task.status + '">' + escHtml(statusLabel) + '</span>';
    if (agentName) html += '<span class="flow-node-agent">' + escHtml(agentName) + '</span>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // drawFlowArrows is no longer needed - arrows are rendered inline as SVG paths
  function drawFlowArrows() { }

  function toggleFlowExpand(taskId, context) {
    state.flowExpanded[taskId] = state.flowExpanded[taskId] === false ? true : false;
    renderFilteredTasks(context);
  }

  // ── Hierarchy View ────────────────────────────
  function renderHierarchyView(listEl, filtered, context) {
    var allTasks = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;
    var html = '<div class="hierarchy-view">';
    filtered.forEach(function(t) {
      html += renderHierarchyNode(t, allTasks, context, 0);
    });
    html += '</div>';
    listEl.innerHTML = html;
  }

  function renderHierarchyNode(task, allTasks, context, depth) {
    var blocked = isTaskBlocked(task, allTasks);
    var hasBlocker = !!task.blocker;
    var subs = findSubtasks(task.id, allTasks);
    var hasChildren = subs.length > 0;
    var expanded = state.hierarchyExpanded[task.id] !== false;
    var statusLabel = STATUS_LABELS[task.status] || (task.status || 'planning').replace(/_/g, ' ');
    var agentName = '';
    if (task.assignedTo) {
      var found = state.agents.find(function(a) { return a.id === task.assignedTo; });
      agentName = found ? found.name : '';
    }
    var depBadge = '';
    if (task.dependsOn && task.dependsOn.length > 0) {
      depBadge = blocked ? '<span class="badge badge-blocked">blocked</span>' : '<span class="hierarchy-dep-badge">deps</span>';
    }
    var blockerBadge = hasBlocker ? '<span class="blocker-badge-small">BLOCKER</span>' : '';

    var html = '<div class="hierarchy-node">';
    html += '<div class="hierarchy-item' + (blocked ? ' blocked' : '') + (hasBlocker ? ' has-blocker' : '') + '" onclick="App.openTask(' + q + task.id + q + ')">';
    html += '<div class="hierarchy-item-left">';
    if (hasChildren) {
      html += '<span class="hierarchy-toggle" onclick="event.stopPropagation();App.toggleHierarchyExpand(' + q + task.id + q + ',' + q + context + q + ')">' + (expanded ? '&#9660;' : '&#9654;') + '</span>';
    } else {
      html += '<span class="hierarchy-toggle">&bull;</span>';
    }
    html += '<span class="hierarchy-title">' + escHtml(task.title) + '</span>';
    if (state.tagsVisible && task.tags && task.tags.length > 0) {
      var treeTags = task.tags.slice(0, 2).map(function(tag) { return renderTagPill(tag); }).join('');
      if (task.tags.length > 2) treeTags += '<span class="task-tag-overflow">+' + (task.tags.length - 2) + '</span>';
      html += treeTags;
    }
    html += '</div>';
    html += '<div class="hierarchy-meta">';
    html += depBadge + blockerBadge;
    html += '<span class="badge badge-' + (task.priority || 'medium') + '">' + escHtml(task.priority || 'medium') + '</span>';
    html += '<span class="badge badge-' + (task.status || 'planning') + '">' + escHtml(statusLabel) + '</span>';
    if (agentName) html += '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(agentName) + '</span>';
    html += '</div></div>';

    if (hasChildren) {
      // Sort subtasks by priority
      subs.sort(function(a, b) {
        var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 2;
        var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 2;
        return pa - pb;
      });
      html += '<div class="hierarchy-children' + (expanded ? '' : ' collapsed') + '">';
      subs.forEach(function(sub) {
        html += renderHierarchyNode(sub, allTasks, context, depth + 1);
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function toggleHierarchyExpand(taskId, context) {
    state.hierarchyExpanded[taskId] = state.hierarchyExpanded[taskId] === false ? true : false;
    renderFilteredTasks(context);
  }

  function setViewMode(mode, context) {
    if (context === 'dashboard') {
      state.dashboardViewMode = mode;
    } else {
      state.agentViewMode = mode;
    }
    // Update toggle button active state
    var panel = context === 'dashboard' ? document.getElementById('dashboard-tasks') : document.getElementById('agent-tasks-list');
    if (panel) {
      var toggle = panel.closest('.panel');
      if (toggle) {
        toggle.querySelectorAll('.view-mode-btn').forEach(function(btn) {
          btn.classList.toggle('active', btn.dataset.view === mode);
        });
      }
    }
    renderFilteredTasks(context);
  }

  var STATUS_LABELS = {
    planning: 'planning', in_progress: 'working', pending_approval: 'pending',
    accepted: 'accepted', closed: 'closed', done: 'closed',
    revision_needed: 'improve', hold: 'hold', cancelled: 'cancelled',
    approved: 'execute'
  };

  function renderTaskCard(t, context, isSubtask, depth) {
    var statusClass = 'badge-' + (t.status || 'planning');
    var priorityClass = 'badge-' + (t.priority || 'medium');
    var agentName = '';
    if (context === 'dashboard' && t.assignedTo) {
      var found = state.agents.find(function(a) { return a.id === t.assignedTo; });
      agentName = found ? found.name : t.assignedTo;
    }
    var hasOutput = t.knowledgeDocId || t.hasDeliverable;
    var outputIcon = hasOutput ? '<span class="task-output-icon" title="Has output"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>' : '';
    var isWorking = t.status === 'in_progress';
    var workingDot = isWorking ? '<span class="agent-working-dot" title="Working"></span>' : '';
    var autopilotIcon = t.autopilot ? '<span class="autopilot-badge" title="Autopilot">&#9881;</span>' : '';
    var blocked = isTaskBlocked(t, state.tasks);
    var blockedBadge = blocked ? '<span class="badge badge-blocked">blocked</span>' : '';
    var hasBlocker = !!t.blocker;
    var blockerBadge = hasBlocker ? '<span class="blocker-badge-small">BLOCKER</span>' : '';
    var subtaskClass = isSubtask ? ' subtask-item' : '';
    var blockerClass = hasBlocker ? ' task-has-blocker' : '';
    var depthStyle = isSubtask && depth ? ' style="padding-left:' + (16 + depth * 16) + 'px;margin-left:' + (depth * 12) + 'px"' : '';
    var statusLabel = STATUS_LABELS[t.status] || (t.status || 'planning').replace(/_/g, ' ');

    var tagPills = '';
    if (state.tagsVisible && t.tags && t.tags.length > 0) {
      tagPills = t.tags.slice(0, 2).map(function(tag) { return renderTagPill(tag); }).join('');
      if (t.tags.length > 2) tagPills += '<span class="task-tag-overflow">+' + (t.tags.length - 2) + '</span>';
    }
    var dueDateHtml = '';
    if (t.dueDate) {
      var dueDate = new Date(t.dueDate);
      var now = new Date();
      now.setHours(0, 0, 0, 0);
      var isOverdue = dueDate < now && t.status !== 'closed' && t.status !== 'done' && t.status !== 'accepted';
      dueDateHtml = '<span class="task-due' + (isOverdue ? ' task-due-overdue' : '') + '" title="Due: ' + dueDate.toLocaleDateString() + '">' + dueDate.toLocaleDateString() + '</span>';
    }
    var timeAgoHtml = t.createdAt ? '<span class="task-time-ago">' + timeAgo(t.createdAt) + '</span>' : '';

    return '<div class="task-item' + subtaskClass + blockerClass + '"' + depthStyle + ' onclick="App.openTask(' + q + t.id + q + ')">' +
      '<span class="task-title">' + outputIcon + autopilotIcon + escHtml(t.title) + tagPills + '</span>' +
      '<span class="task-meta">' +
        '<span class="badge ' + priorityClass + '">' + escHtml(t.priority || 'medium') + '</span>' +
        '<span class="badge ' + statusClass + '">' + escHtml(statusLabel) + workingDot + '</span>' +
        blockedBadge + blockerBadge +
        (agentName ? '<span>' + escHtml(agentName) + '</span>' : '') +
        dueDateHtml + timeAgoHtml +
      '</span></div>';
  }

  function toggleSort(dimension, context) {
    var sortState = context === 'dashboard' ? state.dashboardSort : state.agentSort;
    var other = dimension === 'new' ? 'priority' : 'new';
    if (sortState[dimension] && !sortState[other]) return;
    sortState[dimension] = !sortState[dimension];
    localStorage.setItem(context + 'Sort', JSON.stringify(sortState));
    updateSortButtons(context);
    renderFilteredTasks(context);
  }

  function updateSortButtons(context) {
    var sortState = context === 'dashboard' ? state.dashboardSort : state.agentSort;
    var toggleId = context === 'dashboard' ? 'dashboard-sort-toggle' : 'agent-sort-toggle';
    var toggle = document.getElementById(toggleId);
    if (!toggle) return;
    toggle.querySelectorAll('.sort-btn').forEach(function(btn) {
      btn.classList.toggle('active', !!sortState[btn.dataset.sort]);
    });
  }

  function filterTasks(filter, context) {
    if (context === 'dashboard') {
      state.dashboardTaskFilter = filter;
      // Update stat card highlights
      document.querySelectorAll('.stat-card[data-filter]').forEach(function(card) {
        card.classList.toggle('stat-card-active', card.dataset.filter === filter);
      });
      // Update panel title text without destroying the view-mode-toggle buttons inside the h3
      var titleEl = document.getElementById('dashboard-tasks-title');
      if (titleEl) {
        var labels = { all: 'All Tasks', pending_approval: 'Pending Review', in_progress: 'Working', accepted: 'Accepted', closed: 'Closed', revision_needed: 'Improve', hold: 'On Hold' };
        var titleText = labels[filter] || filter.replace(/_/g, ' ');
        var firstText = titleEl.firstChild;
        if (firstText && firstText.nodeType === 3) {
          firstText.textContent = titleText + '\n        ';
        } else {
          titleEl.insertBefore(document.createTextNode(titleText + '\n        '), titleEl.firstChild);
        }
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
    // Populate agent custom-select
    var agentOpts = document.getElementById('add-task-agent-options');
    if (agentOpts) {
      var agentHtml = '<div class="custom-select-option selected" data-value="">Auto (orchestrator decides)</div>';
      state.agents.forEach(function(a) {
        if (a.isOrchestrator) return;
        agentHtml += '<div class="custom-select-option" data-value="' + a.id + '">' + escHtml(a.name + ' - ' + a.role) + '</div>';
      });
      agentOpts.innerHTML = agentHtml;
    }
    // Reset agent
    setCustomSelect('add-task-agent-select', preselectedAgent || '', preselectedAgent ? (function() {
      var a = state.agents.find(function(ag) { return ag.id === preselectedAgent; });
      return a ? a.name + ' - ' + a.role : 'Auto (orchestrator decides)';
    })() : 'Auto (orchestrator decides)');
    // Reset type and priority
    setCustomSelect('add-task-type-select', 'general', 'General');
    setCustomSelect('add-task-priority-select', 'medium', 'Medium');
    // Reset fields
    document.getElementById('add-task-title').value = '';
    document.getElementById('add-task-desc').value = '';
    document.getElementById('add-task-autopilot').checked = false;
    // Reset due date
    var dueDateInput = document.getElementById('add-task-duedate');
    if (dueDateInput) dueDateInput.value = '';
    // Hide advanced section
    var advSection = document.getElementById('add-task-advanced');
    if (advSection) advSection.classList.add('hidden');
    // Populate parent task custom-select
    var parentOpts = document.getElementById('add-task-parent-options');
    if (parentOpts) {
      var parentHtml = '<div class="custom-select-option selected" data-value="">None</div>';
      (state.cachedDashboardTasks || state.tasks || []).forEach(function(t) {
        if (t.status === 'closed' || t.status === 'done' || t.status === 'cancelled') return;
        parentHtml += '<div class="custom-select-option" data-value="' + t.id + '">' + escHtml(t.title.substring(0, 40)) + '</div>';
      });
      parentOpts.innerHTML = parentHtml;
    }
    setCustomSelect('add-task-parent-select', '', 'None');
    // Initialize depends-on chip input
    state._addTaskDeps = [];
    state._addTaskDepsList = (state.cachedDashboardTasks || state.tasks || []).filter(function(t) {
      return t.status !== 'cancelled';
    });
    renderDepsChips();
    var depsInput = document.getElementById('add-task-depends-input');
    if (depsInput) {
      var newInput = depsInput.cloneNode(true);
      depsInput.parentNode.replaceChild(newInput, depsInput);
      depsInput = newInput;
      depsInput.addEventListener('input', function() { showDepsAutocomplete(depsInput.value.trim()); });
      depsInput.addEventListener('blur', function() {
        setTimeout(function() { document.getElementById('add-task-depends-autocomplete').classList.remove('open'); }, 150);
      });
      depsInput.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && !depsInput.value && state._addTaskDeps.length > 0) {
          state._addTaskDeps.pop();
          renderDepsChips();
        }
      });
    }
    modal.classList.remove('hidden');
    // Init tag input
    initTagInput('add-task-tag-container', []);
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
      var autopilot = document.getElementById('add-task-autopilot').checked;
      var tags = getTagInputTags('add-task-tag-container');
      var dueDate = (document.getElementById('add-task-duedate') || {}).value || '';
      var parentId = (document.getElementById('add-task-parent') || {}).value || '';
      var dependsOn = (state._addTaskDeps || []).slice();

      var taskBody = {
        title: title,
        description: desc || title,
        assignedTo: agent || 'orchestrator',
        status: 'planning',
        priority: priority,
        type: type,
        autopilot: autopilot,
        tags: tags
      };
      // Add interval fields if autopilot is checked and interval is set
      if (autopilot) {
        var intervalVal = parseInt((document.getElementById('add-task-interval') || {}).value) || 0;
        var intervalUnit = (document.getElementById('add-task-interval-unit') || {}).value || '';
        if (intervalVal > 0 && intervalUnit) {
          taskBody.interval = intervalVal;
          taskBody.intervalUnit = intervalUnit;
        }
      }
      if (dueDate) taskBody.dueDate = dueDate;
      if (dependsOn.length > 0) taskBody.dependsOn = dependsOn;

      if (parentId) {
        // Create as subtask
        taskBody.parentTaskId = parentId;
        await api.post('/api/tasks/' + parentId + '/subtasks', taskBody);
      } else {
        await api.post('/api/tasks', taskBody);
      }
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
    if (tab === 'files' && state.currentAgentId) {
      loadAgentFiles(state.currentAgentId);
    }
  }

  function switchFilesSubTab(subtab) {
    document.querySelectorAll('.agent-files-subtab').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.subtab === subtab);
    });
    document.querySelectorAll('.agent-files-subtab-panel').forEach(function(panel) {
      panel.classList.toggle('active', panel.id === 'agent-files-subtab-' + subtab);
    });
  }

  // ── Agent Files Tab ─────────────────────────────
  var agentFilesCache = { agentId: null, data: null };

  async function loadAgentFiles(agentId, force) {
    if (!force && agentFilesCache.agentId === agentId && agentFilesCache.data) {
      renderAgentFiles(agentFilesCache.data, agentId);
      return;
    }
    document.getElementById('agent-files-content-list').innerHTML = '<p class="empty-state">Loading...</p>';
    document.getElementById('agent-files-reports').innerHTML = '<p class="empty-state">Loading...</p>';
    try {
      var data = await api.get('/api/agents/' + agentId + '/files');
      agentFilesCache = { agentId: agentId, data: data };
      renderAgentFiles(data, agentId);
      // Update tab button text with count
      var filesBtn = document.querySelector('.tab-btn[data-tab="files"]');
      if (filesBtn) filesBtn.textContent = 'Files' + (data.totalFiles ? ' (' + data.totalFiles + ')' : '');
    } catch(e) {
      document.getElementById('agent-files-content-list').innerHTML = '<p class="empty-state">Failed to load files.</p>';
      document.getElementById('agent-files-reports').innerHTML = '<p class="empty-state">Failed to load files.</p>';
    }
  }

  function renderAgentFiles(data, agentId) {
    var reportCount = 0;
    (data.reports || []).forEach(function(g) { reportCount += g.files.length; });
    var contentCount = 0;
    (data.content || []).forEach(function(g) { contentCount += g.files.length; });
    var rcEl = document.getElementById('agent-files-reports-count');
    var ccEl = document.getElementById('agent-files-content-count');
    if (rcEl) rcEl.textContent = '(' + reportCount + ')';
    if (ccEl) ccEl.textContent = '(' + contentCount + ')';
    renderFilesSection('agent-files-content-list', data.content || []);
    renderFilesSection('agent-files-reports', data.reports || []);
  }

  function renderFilesSection(containerId, groups) {
    var container = document.getElementById(containerId);
    if (!container) return;
    if (!groups || groups.length === 0) {
      container.innerHTML = '<p class="empty-state">No files yet</p>';
      return;
    }
    var html = '';
    groups.forEach(function(g) {
      html += '<div class="agent-files-task-group">';
      html += '<div class="agent-files-task-title" onclick="App.openTask(\'' + g.taskId + '\')">' + escHtml(g.taskTitle) + '</div>';
      g.files.forEach(function(f) {
        var safeName = encodeURIComponent(f.name);
        html += '<div class="agent-files-entry">';
        if (f.isImage) {
          html += '<img src="' + f.rawUrl + '" class="agent-files-entry-thumb" alt="' + escHtml(f.name) + '">';
        }
        html += '<div class="agent-files-entry-info">';
        html += '<a href="javascript:void(0)" onclick="App.previewFileInModal(decodeURIComponent(\'' + safeName + '\'),\'' + f.rawUrl + '\',' + f.isImage + ')" class="agent-files-entry-name">' + escHtml(f.name) + '</a>';
        html += '<div class="agent-files-entry-meta">';
        html += '<span class="agent-files-entry-task" onclick="App.openTask(\'' + g.taskId + '\')">' + escHtml(g.taskTitle) + '</span>';
        if (g.createdAt) {
          html += ' <span class="agent-files-entry-date">' + timeAgo(g.createdAt) + '</span>';
        }
        html += '</div></div></div>';
      });
      html += '</div>';
    });
    container.innerHTML = html;
  }

  function toggleFilesSection(section) {
    // Legacy - no longer used with sub-tabs
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
      var displayStatus = task.status || 'planning';
      if (displayStatus === 'done') displayStatus = 'closed';
      var statusLabel = STATUS_LABELS[displayStatus] || displayStatus.replace(/_/g, ' ');
      if (displayStatus === 'in_progress') {
        statusEl.innerHTML = escHtml(statusLabel) + ' <span class="agent-working-dot"></span>';
      } else {
        statusEl.textContent = statusLabel;
      }
      statusEl.className = 'badge badge-' + displayStatus;

      var priorityEl = document.getElementById('task-detail-priority');
      priorityEl.textContent = task.priority || 'medium';
      priorityEl.className = 'badge badge-' + (task.priority || 'medium');

      var agentName = task.assignedTo || 'Unassigned';
      if (task.assignedTo && state.agents.length > 0) {
        var found = state.agents.find(function(a) { return a.id === task.assignedTo; });
        if (found) agentName = found.name;
      }
      document.getElementById('task-detail-agent').textContent = agentName;
      var dateHtml = '';
      if (task.createdAt) dateHtml += 'Created: ' + new Date(task.createdAt).toLocaleString() + ' (' + timeAgo(task.createdAt) + ')';
      if (task.updatedAt && task.updatedAt !== task.createdAt) dateHtml += ' | Updated: ' + new Date(task.updatedAt).toLocaleString() + ' (' + timeAgo(task.updatedAt) + ')';
      if (task.dueDate) {
        var dueDate = new Date(task.dueDate);
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var isOverdue = dueDate < today && task.status !== 'closed' && task.status !== 'done' && task.status !== 'accepted';
        dateHtml += ' | <span class="' + (isOverdue ? 'task-due-overdue' : 'task-due-detail') + '">Due: ' + dueDate.toLocaleDateString() + '</span>';
      }
      document.getElementById('task-detail-date').innerHTML = dateHtml || '-';

      var tagsEl = document.getElementById('task-detail-tags');
      if (task.tags && task.tags.length > 0) {
        tagsEl.innerHTML = task.tags.map(function(tag) { return renderTagBadge(tag); }).join('');
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
        knowledgeLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> <a onclick="App.openKnowledgeDoc(\'' + task.knowledgeDocId + '\')">View in Knowledge Base</a>';
        knowledgeLink.classList.remove('hidden');
      } else if (task.status === 'accepted' || task.status === 'closed' || task.status === 'done') {
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
      if (typeof marked !== 'undefined' && marked.parse) {
        var renderer = new marked.Renderer();
        // Rewrite image src for local paths to use /api/raw/
        renderer.image = function(href, title, altText) {
          // marked v4+ may pass an object as first arg
          if (typeof href === 'object') { title = href.title; altText = href.text; href = href.href; }
          if (href && !href.match(/^https?:\/\//) && (href.match(/^(data|temp)\//) || href.startsWith('/api/'))) {
            if (!href.startsWith('/api/')) href = '/api/raw/' + href;
          }
          var t = title ? ' title="' + escHtml(title) + '"' : '';
          return '<img src="' + escHtml(href) + '" alt="' + escHtml(altText || '') + '"' + t + ' style="max-width:100%;border-radius:6px;margin:8px 0;cursor:pointer" onclick="window.open(this.src,\'_blank\')">';
        };
        var html = marked.parse(text, { renderer: renderer });
        // Also render plain-text image paths as clickable thumbnails
        html = html.replace(/(^|[>\s])((?:data|temp)\/[^\s<"']+\.(?:png|jpg|jpeg|gif|webp|svg))(?=[\s<]|$)/gi, function(m, pre, path) {
          // Skip if already inside an HTML tag attribute
          if (pre === '"' || pre === "'") return m;
          return pre + '<a href="/api/raw/' + path + '" target="_blank" style="display:inline-block;margin:4px 0"><img src="/api/raw/' + path + '" alt="' + escHtml(path) + '" style="max-width:320px;max-height:200px;border-radius:6px;border:1px solid var(--border)"></a>';
        });
        return html;
      }
      return escHtml(text).replace(/\n/g, '<br>');
    } catch(e) {
      return escHtml(text).replace(/\n/g, '<br>');
    }
  }

  async function renderTaskSession(taskId, task, agentName) {
    var container = document.getElementById('task-session');
    var html = '';

    // ── Blocker Banner ──
    if (task.blocker) {
      html += '<div class="blocker-banner">';
      html += '<span class="blocker-banner-icon">&#9888;</span>';
      html += '<span class="blocker-banner-text"><strong>BLOCKER:</strong> ' + linkifyText(escHtml(task.blocker)) + '</span>';
      html += '</div>';
    }

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

    if (versions.length === 0 && task.status === 'planning' && (!task.progressLog || task.progressLog.length === 0)) {
      html += '<div class="session-awaiting">Awaiting agent submission...</div>';
    }

    // ── Build unified timeline ──
    // Collect all events: versions, progress entries, owner feedback
    var timeline = [];

    // Add version events
    versions.forEach(function(v, idx) {
      var ts = v.submittedAt || v.decidedAt || task.createdAt || '';
      timeline.push({ type: 'version', data: v, idx: idx, timestamp: ts });
      // Add owner feedback as separate event after version
      if (v.decision || v.comments) {
        var fbTs = v.decidedAt || v.submittedAt || ts;
        // Push feedback slightly after version so it sorts after
        timeline.push({ type: 'feedback', data: v, timestamp: fbTs, _after: true });
      }
    });

    // Add progress log entries
    if (task.progressLog && task.progressLog.length > 0) {
      task.progressLog.forEach(function(entry) {
        timeline.push({ type: 'progress', data: entry, timestamp: entry.timestamp || '' });
      });
    }

    // Sort chronologically (versions and their feedback stay ordered by _after flag)
    timeline.sort(function(a, b) {
      var ta = new Date(a.timestamp || 0).getTime();
      var tb = new Date(b.timestamp || 0).getTime();
      if (ta !== tb) return ta - tb;
      // Same timestamp: version before feedback, feedback before progress
      var order = { version: 0, feedback: 1, progress: 2 };
      return (order[a.type] || 0) - (order[b.type] || 0);
    });

    // Render unified timeline
    if (timeline.length > 0) {
      html += '<div class="unified-timeline">';
      timeline.forEach(function(evt) {
        if (evt.type === 'version') {
          var v = evt.data;
          var idx = evt.idx;
          var isLatest = idx === versions.length - 1;
          var isApproved = v.decision === 'approve' || v.decision === 'approved' || v.decision === 'accepted';
          var isImproved = v.decision === 'improve';

          html += '<div class="session-version' + (isLatest ? ' latest' : '') + '">';
          html += '<div class="tl-accent tl-accent-version">';
          html += '<div class="session-version-header">';
          html += '<div class="session-version-id">';
          html += '<span class="session-dot' + (isApproved ? ' dot-approved' : isImproved ? ' dot-improved' : '') + '"></span>';
          html += 'v' + v.number;
          if (v.submittedAt) html += ' - ' + new Date(v.submittedAt).toLocaleDateString();
          else if (v.decidedAt) html += ' - ' + new Date(v.decidedAt).toLocaleDateString();
          html += '</div>';
          html += '<span class="session-agent-name">Agent: ' + escHtml(agentName) + '</span>';
          html += '</div>';

          if (v.content) {
            html += '<div class="session-content">' + renderMarkdown(v.content) + '</div>';
          } else {
            html += '<div class="session-content"><span class="empty-state" style="padding:8px">Awaiting submission...</span></div>';
          }
          html += '</div>'; // close tl-accent-version

          if (v.deliverable) {
            html += '<div class="tl-accent tl-accent-deliverable"><div class="version-deliverable"><div class="version-deliverable-label">Deliverable</div>' + linkifyText(escHtml(v.deliverable)).replace(/\n/g, '<br>') + '</div></div>';
          }
          if (v.result) {
            html += '<div class="tl-accent tl-accent-result"><div class="version-result"><div class="version-result-label">Result</div>' + linkifyText(escHtml(v.result)).replace(/\n/g, '<br>') + '</div></div>';
          }
          if (v.files && v.files.length > 0) {
            var imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
            html += '<div class="tl-accent tl-accent-files"><div class="version-files"><div class="version-files-label">Deliverable Files</div>' +
              v.files.map(function(f) {
                var ext = f.lastIndexOf('.') >= 0 ? f.slice(f.lastIndexOf('.')).toLowerCase() : '';
                var rawUrl = '/api/tasks/' + taskId + '/versions/' + v.number + '/files/' + encodeURIComponent(f) + '/raw';
                var isImage = imageExts.indexOf(ext) >= 0;
                var textExts = ['.md', '.txt', '.json', '.js', '.css', '.html', '.csv', '.xml', '.yaml', '.yml', '.log'];
                var isText = textExts.indexOf(ext) >= 0;
                var linkHtml = '<div class="version-file-item">';
                var safeName = encodeURIComponent(f);
                if (isImage) {
                  linkHtml += '<a href="javascript:void(0)" onclick="App.previewFileInModal(decodeURIComponent(\'' + safeName + '\'),\'' + rawUrl + '\',true,\'' + taskId + '\')" class="version-file-thumb-link"><img src="' + rawUrl + '" class="version-file-thumb" alt="' + escHtml(f) + '"></a>';
                }
                if (isImage || isText) {
                  linkHtml += '<a href="javascript:void(0)" onclick="App.previewFileInModal(decodeURIComponent(\'' + safeName + '\'),\'' + rawUrl + '\',' + isImage + ',\'' + taskId + '\')" class="version-file-link">' + escHtml(f) + '</a>';
                } else {
                  linkHtml += '<a href="' + rawUrl + '" target="_blank" class="version-file-link">' + escHtml(f) + '</a>';
                }
                linkHtml += '</div>';
                return linkHtml;
              }).join('') + '</div></div>';
          }

          html += '</div>'; // close session-version

        } else if (evt.type === 'feedback') {
          var v = evt.data;
          var fbAccentClass = (v.decision === 'done' || v.decision === 'closed') ? 'tl-accent-closed' : 'tl-accent-feedback';
          var fbClass = v.decision === 'improve' ? 'session-feedback-improve' : (v.decision === 'approved' || v.decision === 'accepted') ? 'session-feedback-approved' : (v.decision === 'done' || v.decision === 'closed') ? 'session-feedback-done' : '';
          html += '<div class="session-feedback ' + fbClass + '">';
          html += '<div class="tl-accent ' + fbAccentClass + '">';
          html += '<div class="session-feedback-label">Owner Feedback';
          if (v.decision) {
            var decisionLabels = { accepted: 'Accepted', approved: 'Execute', improve: 'Improve', done: 'Closed', closed: 'Closed', hold: 'Hold', cancelled: 'Cancelled' };
            html += ' <span class="badge badge-' + (v.decision) + '">' + (decisionLabels[v.decision] || v.decision) + '</span>';
          }
          if (v.decidedAt) html += '<span class="session-feedback-date">' + new Date(v.decidedAt).toLocaleDateString() + '</span>';
          html += '</div>';
          if (v.comments) {
            html += '<div class="session-feedback-text">' + linkifyText(escHtml(v.comments)).replace(/\n/g, '<br>') + '</div>';
          }
          html += '</div>'; // close tl-accent
          html += '</div>';

        } else if (evt.type === 'progress') {
          var entry = evt.data;
          var isBlocker = /blocker/i.test(entry.message);
          var hasUrl = /(https?:\/\/[^\s]+)/i.test(entry.message);
          var entryClass = 'timeline-progress';
          if (isBlocker) entryClass += ' timeline-progress-blocker';
          if (hasUrl) entryClass += ' timeline-progress-url';
          var agentLabel = entry.agentId || '';
          var agents = state.agents || [];
          for (var ai = 0; ai < agents.length; ai++) {
            if (agents[ai].id === entry.agentId) { agentLabel = agents[ai].name; break; }
          }
          var timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : '';

          var progressAccent = isBlocker ? 'tl-accent-blocker' : 'tl-accent-progress';
          html += '<div class="' + entryClass + '">';
          html += '<div class="tl-accent ' + progressAccent + '">';
          if (isBlocker) html += '<span class="progress-blocker-badge">BLOCKER</span> ';
          html += '<span class="timeline-progress-message">' + linkifyText(escHtml(entry.message)) + '</span>';
          html += '<span class="timeline-progress-meta">' + escHtml(agentLabel) + (timeStr ? ' - ' + timeStr : '') + '</span>';
          html += '</div></div>';
        }
      });
      html += '</div>'; // close unified-timeline
    }

    // ── Bottom section: status pipeline + feedback ──
    html += buildStatusPipeline(task);

    container.innerHTML = html;
  }

  function buildStatusPipeline(task) {
    var current = task.status || 'planning';
    // Map legacy 'done' to 'closed' for display
    if (current === 'done') current = 'closed';

    var steps = [
      { key: 'pending_approval', label: 'Pending',   icon: '&#9679;'  },
      { key: 'accepted',         label: 'Accepted <span style="color:#6f6;font-size:0.75em;margin-left:2px">&#9654;</span>',  icon: '&#10003;', action: 'accept' },
      { key: 'closed',           label: 'Closed',    icon: '&#9632;', action: 'close'  }
    ];
    var sideStates = [
      { key: 'improve',   label: 'Improve', icon: '&#9999;', needsFeedback: true },
      { key: 'hold',      label: 'Hold',    icon: '&#9208;' },
      { key: 'cancelled', label: 'Cancel',  icon: '&#10007;' }
    ];

    var html = '<div class="status-pipeline">';

    // Single row: Working indicator | Autopilot | gap | main flow | side actions | ... | prev/next
    html += '<div class="status-pipeline-row">';

    // Working indicator (before autopilot)
    var isWorking = current === 'in_progress' || current === 'planning' || current === 'revision_needed';
    if (isWorking) {
      html += '<span class="pipeline-working-indicator"><span class="agent-working-dot"></span> Working</span>';
    }

    // Autopilot toggle
    html += '<button class="autopilot-toggle' + (task.autopilot ? ' active' : '') + '" onclick="App.toggleTaskAutopilot()" title="Toggle autopilot mode">';
    html += '&#9881; Autopilot ' + (task.autopilot ? 'ON' : 'OFF');
    html += '</button>';

    // Recurring autopilot info
    if (task.autopilot && task.interval && task.intervalUnit) {
      html += '<div class="autopilot-recurring-info" style="display:inline-flex;align-items:center;gap:8px;margin-left:8px;font-size:12px;color:var(--text-muted)">';
      html += '<span>Every ' + task.interval + (task.intervalUnit === 'minutes' ? 'm' : task.intervalUnit === 'hours' ? 'h' : 'd') + '</span>';
      if (task.lastRun) html += '<span>Last: ' + new Date(task.lastRun).toLocaleString() + '</span>';
      if (task.nextRun) html += '<span>Next: ' + new Date(task.nextRun).toLocaleString() + '</span>';
      if (task.runCount) html += '<span>Runs: ' + task.runCount + '</span>';
      html += '</div>';
    }

    html += '<span class="pipeline-gap"></span>';

    // Main flow steps
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var isActive = s.key === current;
      var isPast = getStepIndex(current, steps) > i;
      var cls = 'status-step';
      if (isActive) cls += ' status-step-active';
      else if (isPast) cls += ' status-step-past';

      if (s.action) {
        html += '<button class="' + cls + '" onclick="App.changeTaskStatus(\'' + s.action + '\')" title="Set to ' + s.label + '">';
        html += '<span class="status-step-icon">' + s.icon + '</span>';
        html += '<span class="status-step-label">' + s.label + '</span>';
        html += '</button>';
      } else {
        html += '<span class="' + cls + ' status-step-indicator" title="' + s.label + '">';
        html += '<span class="status-step-icon">' + s.icon + '</span>';
        html += '<span class="status-step-label">' + s.label + '</span>';
        html += '</span>';
      }
      if (i < steps.length - 1) html += '<span class="status-step-arrow' + (isPast ? ' status-step-arrow-past' : '') + '">&#8250;</span>';
    }

    // Side states (improve, hold, cancel)
    for (var j = 0; j < sideStates.length; j++) {
      var ss = sideStates[j];
      var isActiveSide = (ss.key === 'improve' && current === 'revision_needed') || ss.key === current;
      if (ss.needsFeedback) {
        html += '<button class="status-step status-step-side' + (isActiveSide ? ' status-step-active' : '') + '" onclick="App.toggleFeedback()" title="Send feedback for revision">';
      } else {
        html += '<button class="status-step status-step-side' + (isActiveSide ? ' status-step-active' : '') + '" onclick="App.changeTaskStatus(\'' + ss.key + '\')" title="Set to ' + ss.label + '">';
      }
      html += '<span class="status-step-icon">' + ss.icon + '</span>';
      html += '<span class="status-step-label">' + ss.label + '</span>';
      html += '</button>';
    }

    // Prev/Next navigation aligned right
    if ((state.tasks || []).length > 1) {
      html += '<div class="task-nav-buttons">';
      html += '<button class="task-nav-btn" onclick="App.navigateTask(\'prev\')" title="Previous task (Left arrow)">&#8249; Prev</button>';
      html += '<button class="task-nav-btn" onclick="App.navigateTask(\'next\')" title="Next task (Right arrow)">Next &#8250;</button>';
      html += '</div>';
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

    // Subtask section (for parent tasks)
    if (task.subtasks && task.subtasks.length > 0) {
      html += '<div class="subtask-section">';
      html += '<div class="subtask-section-title">Subtasks</div>';
      task.subtasks.forEach(function(sid) {
        var sub = state.tasks.find(function(t) { return t.id === sid; });
        if (sub) {
          var subStatus = STATUS_LABELS[sub.status] || sub.status;
          html += '<div class="task-item subtask-item" onclick="App.openTask(\'' + sid + '\')">';
          html += '<span class="task-title">' + escHtml(sub.title) + '</span>';
          html += '<span class="task-meta"><span class="badge badge-' + sub.status + '">' + escHtml(subStatus) + '</span></span>';
          html += '</div>';
        }
      });
      html += '</div>';
    }

    // Parent breadcrumb (for subtasks)
    if (task.parentTaskId) {
      var parent = state.tasks.find(function(t) { return t.id === task.parentTaskId; });
      if (parent) {
        html += '<div class="parent-breadcrumb" onclick="App.openTask(\'' + task.parentTaskId + '\')">&#8592; Parent: ' + escHtml(parent.title) + '</div>';
      }
    }

    // Result display
    if (task.result && (current === 'closed' || current === 'accepted')) {
      html += '<div class="session-outcome">';
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

  async function toggleTaskAutopilot() {
    var id = state.currentTaskId;
    if (!id) return;
    try {
      var task = await api.get('/api/tasks/' + id);
      var newVal = !task.autopilot;
      await api.put('/api/tasks/' + id, { autopilot: newVal });
      toast('Autopilot ' + (newVal ? 'enabled' : 'disabled'));
      await openTask(id);
    } catch(e) {
      toast('Failed: ' + e.message, 'error');
    }
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
            return { blob: blob, error: null };
          }
        }
      }
      return { blob: null, error: null };
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        return { blob: null, error: 'permission' };
      }
      return { blob: null, error: e.message };
    }
  }

  function blobToBase64(blob) {
    // Compress image to fit within server body limit (20MB)
    return new Promise(function(resolve, reject) {
      var img = new Image();
      var objUrl = URL.createObjectURL(blob);
      img.onload = function() {
        URL.revokeObjectURL(objUrl);
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
      img.onerror = function() { URL.revokeObjectURL(objUrl); reject(new Error('Image load failed')); };
      img.src = objUrl;
    });
  }

  async function pasteImage() {
    var clip = await readClipboardImage();
    if (clip.error === 'permission') {
      toast('Clipboard permission denied — click the page first', 'error');
      return;
    }
    if (!clip.blob) {
      toast(clip.error ? 'Clipboard error: ' + clip.error : 'No image found in clipboard', 'error');
      return;
    }
    try {
      var b64 = await blobToBase64(clip.blob);
      var result = await api.post('/api/upload-image', { data: b64, destination: 'clipboard' });
      var previewArea = document.getElementById('paste-preview-area');
      var previewImg = document.getElementById('paste-preview-img');
      var previewPath = document.getElementById('paste-preview-path');
      if (previewArea && previewImg && previewPath) {
        var previewUrl = URL.createObjectURL(clip.blob);
        previewImg.onload = function() { URL.revokeObjectURL(previewUrl); };
        previewImg.src = previewUrl;
        previewPath.textContent = result.path;
        previewArea.classList.remove('hidden');
      }
      // Copy path to clipboard instead of auto-sending to terminal
      var absPath = result.absPath || result.path;
      try { await navigator.clipboard.writeText(absPath); } catch(e) {}
      toast('Image saved (path copied)');
    } catch (e) {
      toast('Failed to upload image: ' + e.message, 'error');
    }
    if (terminal) terminal.focus();
  }

  async function attachTaskImage() {
    var taskId = state.currentTaskId;
    if (!taskId) { toast('No task selected', 'error'); return; }
    var clip = await readClipboardImage();
    if (clip.error === 'permission') {
      toast('Clipboard permission denied — click the page first', 'error');
      return;
    }
    if (!clip.blob) {
      toast(clip.error ? 'Clipboard error: ' + clip.error : 'No image found in clipboard', 'error');
      return;
    }
    try {
      var b64 = await blobToBase64(clip.blob);
      var result = await api.post('/api/upload-image', { data: b64, destination: 'task', taskId: taskId });
      var area = document.getElementById('feedback-image-area');
      if (area) {
        var img = document.createElement('img');
        var imgUrl = URL.createObjectURL(clip.blob);
        img.onload = function() { URL.revokeObjectURL(imgUrl); };
        img.src = imgUrl;
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

    // Confirmation for Accept
    if (newStatus === 'accept') {
      var ok = await confirmAction({
        title: 'Accept this task?',
        message: 'This will approve the work and trigger the agent to execute.',
        confirmLabel: 'Accept',
        variant: 'neutral'
      });
      if (!ok) return;
    }

    try {
      // Actions that go through the action handler (write version timeline)
      var actionStatuses = { accept: true, close: true };
      if (actionStatuses[newStatus]) {
        await api.put('/api/tasks/' + id, { action: newStatus });
      } else {
        await api.put('/api/tasks/' + id, { status: newStatus });
      }
      var labels = {
        planning: 'Set to planning', pending_approval: 'Pending review',
        in_progress: 'Working', accept: 'Accepted',
        close: 'Closed', hold: 'On hold', cancelled: 'Cancelled'
      };
      toast(labels[newStatus] || 'Status updated');

      // After successful Accept, inject PTY message to trigger orchestrator
      if (newStatus === 'accept') {
        if (termWs && termWs.readyState === 1) {
          var task = await api.get('/api/tasks/' + id);
          var msg = 'Task ' + id + ' "' + task.title + '" was accepted by the owner. Launch the assigned agent to execute it.\r';
          termWs.send(JSON.stringify({ type: 'input', data: msg }));
        } else {
          toast('Terminal not connected - tell the orchestrator manually', 'warning');
        }
      }

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

    var ok = await confirmAction({
      title: 'Send revision feedback?',
      message: 'This will request the agent to revise their work with your feedback.',
      confirmLabel: 'Send Feedback',
      variant: 'neutral'
    });
    if (!ok) return;

    try {
      await api.put('/api/tasks/' + id, { action: 'improve', comments: comments });
      toast('Feedback sent - revision requested');

      // Inject PTY message to trigger agent revision
      if (termWs && termWs.readyState === 1) {
        var task = await api.get('/api/tasks/' + id);
        var msg = 'Task ' + id + ' "' + task.title + '" received revision feedback from the owner: "' + comments.replace(/"/g, "'") + '". Launch the assigned agent to revise.\r';
        termWs.send(JSON.stringify({ type: 'input', data: msg }));
      } else {
        toast('Terminal not connected - tell the orchestrator manually', 'warning');
      }

      await openTask(id);
    } catch(e) {
      toast('Failed: ' + e.message, 'error');
    }
  }

  // Legacy — kept for compatibility but no longer rendered as separate panel
  async function renderProgressLog(taskId, task) { }
  async function renderVersionTimeline(taskId) { }

  function closeFilePreview() {
    var overlay = document.getElementById('file-preview-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function togglePreviewFeedback() {
    var overlay = document.getElementById('file-preview-overlay');
    if (!overlay) return;
    var panel = overlay.querySelector('.file-preview-feedback');
    if (!panel) return;
    var isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (isHidden) {
      var ta = panel.querySelector('.file-preview-feedback-textarea');
      if (ta) { ta.value = ''; ta.focus(); }
      var imgArea = panel.querySelector('.file-preview-feedback-images');
      if (imgArea) imgArea.innerHTML = '';
    }
  }

  async function submitPreviewFeedback() {
    var overlay = document.getElementById('file-preview-overlay');
    if (!overlay) return;
    var taskId = overlay.dataset.taskId;
    if (!taskId) { toast('No task context', 'error'); return; }
    var ta = overlay.querySelector('.file-preview-feedback-textarea');
    var comments = ta ? ta.value.trim() : '';
    if (!comments) {
      toast('Please add feedback for the agent', 'error');
      if (ta) ta.focus();
      return;
    }

    var ok = await confirmAction({
      title: 'Send revision feedback?',
      message: 'This will request the agent to revise their work with your feedback.',
      confirmLabel: 'Send Feedback',
      variant: 'neutral'
    });
    if (!ok) return;

    try {
      await api.put('/api/tasks/' + taskId, { action: 'improve', comments: comments });
      toast('Feedback sent - revision requested');

      // Inject PTY message to trigger agent revision
      if (termWs && termWs.readyState === 1) {
        var task = await api.get('/api/tasks/' + taskId);
        var msg = 'Task ' + taskId + ' "' + task.title + '" received revision feedback from the owner: "' + comments.replace(/"/g, "'") + '". Launch the assigned agent to revise.\r';
        termWs.send(JSON.stringify({ type: 'input', data: msg }));
      } else {
        toast('Terminal not connected - tell the orchestrator manually', 'warning');
      }

      closeFilePreview();
      if (state.currentTaskId === taskId) {
        await openTask(taskId);
      }
    } catch(e) {
      toast('Failed: ' + e.message, 'error');
    }
  }

  async function attachPreviewImage() {
    var overlay = document.getElementById('file-preview-overlay');
    if (!overlay) return;
    var taskId = overlay.dataset.taskId;
    if (!taskId) { toast('No task context', 'error'); return; }
    var clip = await readClipboardImage();
    if (clip.error === 'permission') {
      toast('Clipboard permission denied - click the page first', 'error');
      return;
    }
    if (!clip.blob) {
      toast(clip.error ? 'Clipboard error: ' + clip.error : 'No image found in clipboard', 'error');
      return;
    }
    try {
      var b64 = await blobToBase64(clip.blob);
      var result = await api.post('/api/upload-image', { data: b64, destination: 'task', taskId: taskId });
      var imgArea = overlay.querySelector('.file-preview-feedback-images');
      if (imgArea) {
        var img = document.createElement('img');
        var imgUrl = URL.createObjectURL(clip.blob);
        img.onload = function() { URL.revokeObjectURL(imgUrl); };
        img.src = imgUrl;
        img.className = 'feedback-image-preview';
        imgArea.innerHTML = '';
        imgArea.appendChild(img);
        var pathSpan = document.createElement('span');
        pathSpan.className = 'paste-path';
        pathSpan.textContent = result.path;
        pathSpan.style.display = 'block';
        pathSpan.style.marginTop = '4px';
        imgArea.appendChild(pathSpan);
      }
      var ta = overlay.querySelector('.file-preview-feedback-textarea');
      if (ta) {
        var sep = ta.value.trim() ? '\n' : '';
        ta.value += sep + '[Attached image: ' + result.path + ']';
      }
      toast('Image attached: ' + result.path);
    } catch (e) {
      toast('Failed to upload image: ' + e.message, 'error');
    }
  }

  function showFilePreview(filename, content, rawUrl, taskId) {
    var overlay = document.getElementById('file-preview-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'file-preview-overlay';
      overlay.className = 'file-preview-overlay';
      overlay.innerHTML = '<div class="file-preview-modal">' +
        '<div class="file-preview-header">' +
          '<span class="file-preview-title"></span>' +
          '<div class="file-preview-actions">' +
            '<button class="file-preview-improve-btn" onclick="App.togglePreviewFeedback()" title="Send feedback">&#9998; Improve</button>' +
            '<a class="file-preview-newtab" target="_blank" title="Open in new tab">&#8599;</a>' +
            '<button class="file-preview-close" onclick="App.closeFilePreview()" title="Close">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="file-preview-body"></div>' +
        '<div class="file-preview-feedback hidden">' +
          '<textarea class="file-preview-feedback-textarea" placeholder="Write feedback for the agent..."></textarea>' +
          '<div class="file-preview-feedback-actions">' +
            '<button class="btn btn-primary" onclick="App.submitPreviewFeedback()">Send Feedback</button>' +
            '<button class="attach-image-btn" onclick="App.attachPreviewImage()" title="Paste image from clipboard">&#128203; Attach Image</button>' +
            '<button class="btn btn-secondary" onclick="App.togglePreviewFeedback()">Cancel</button>' +
          '</div>' +
          '<div class="file-preview-feedback-images"></div>' +
        '</div>' +
      '</div>';
      overlay.addEventListener('click', function(e) { if (e.target === overlay) closeFilePreview(); });
      document.body.appendChild(overlay);
    }
    // Store taskId on the overlay
    if (taskId) {
      overlay.dataset.taskId = taskId;
    } else {
      delete overlay.dataset.taskId;
    }
    // Show/hide improve button based on task context
    var improveBtn = overlay.querySelector('.file-preview-improve-btn');
    if (improveBtn) {
      improveBtn.style.display = taskId ? '' : 'none';
    }
    // Reset feedback panel
    var feedbackPanel = overlay.querySelector('.file-preview-feedback');
    if (feedbackPanel) {
      feedbackPanel.classList.add('hidden');
      var ta = feedbackPanel.querySelector('.file-preview-feedback-textarea');
      if (ta) ta.value = '';
      var imgArea = feedbackPanel.querySelector('.file-preview-feedback-images');
      if (imgArea) imgArea.innerHTML = '';
    }
    overlay.querySelector('.file-preview-title').textContent = filename;
    var newtabLink = overlay.querySelector('.file-preview-newtab');
    if (rawUrl) {
      newtabLink.href = rawUrl;
      newtabLink.style.display = '';
    } else {
      newtabLink.style.display = 'none';
    }
    var body = overlay.querySelector('.file-preview-body');
    if (filename.endsWith('.md') && typeof marked !== 'undefined' && marked.parse) {
      body.innerHTML = renderMarkdown(content);
    } else {
      body.innerHTML = '<pre>' + escHtml(content) + '</pre>';
    }
    body.scrollTop = 0;
    overlay.classList.remove('hidden');
  }

  function showImagePreview(filename, rawUrl, taskId) {
    var overlay = document.getElementById('file-preview-overlay');
    if (!overlay) {
      showFilePreview(filename, '', rawUrl, taskId);
    }
    var ov = document.getElementById('file-preview-overlay');
    if (!ov) return;
    // Store taskId on overlay
    if (taskId) {
      ov.dataset.taskId = taskId;
    } else {
      delete ov.dataset.taskId;
    }
    // Show/hide improve button
    var improveBtn = ov.querySelector('.file-preview-improve-btn');
    if (improveBtn) {
      improveBtn.style.display = taskId ? '' : 'none';
    }
    // Reset feedback panel
    var feedbackPanel = ov.querySelector('.file-preview-feedback');
    if (feedbackPanel) {
      feedbackPanel.classList.add('hidden');
      var ta = feedbackPanel.querySelector('.file-preview-feedback-textarea');
      if (ta) ta.value = '';
      var imgArea = feedbackPanel.querySelector('.file-preview-feedback-images');
      if (imgArea) imgArea.innerHTML = '';
    }
    ov.querySelector('.file-preview-title').textContent = filename;
    var newtabLink = ov.querySelector('.file-preview-newtab');
    newtabLink.href = rawUrl;
    newtabLink.style.display = '';
    var body = ov.querySelector('.file-preview-body');
    body.innerHTML = '<div class="file-preview-image-wrap"><img src="' + rawUrl + '" alt="' + escHtml(filename) + '" class="file-preview-image"></div>';
    body.scrollTop = 0;
    ov.classList.remove('hidden');
  }

  function previewFileInModal(filename, rawUrl, isImage, taskId) {
    if (isImage) {
      showImagePreview(filename, rawUrl, taskId);
      return;
    }
    // Fetch text content and show in modal
    fetch(rawUrl).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function(text) {
      showFilePreview(filename, text, rawUrl, taskId);
    }).catch(function() {
      // Fallback: open in new tab
      window.open(rawUrl, '_blank');
    });
  }

  // Escape key to close file preview
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var overlay = document.getElementById('file-preview-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        closeFilePreview();
        e.stopPropagation();
      }
    }
  });

  async function viewVersionFile(el) {
    var taskId = el.dataset.task;
    var version = el.dataset.version;
    var file = el.dataset.file;
    var rawUrl = '/api/tasks/' + taskId + '/versions/' + version + '/files/' + encodeURIComponent(file) + '/raw';
    try {
      var data = await api.get('/api/tasks/' + taskId + '/versions/' + version + '/files/' + encodeURIComponent(file));
      showFilePreview(file, data.content, rawUrl, taskId);
    } catch(e) {
      toast('Failed to load file', 'error');
    }
  }

  async function viewFile(filePath) {
    var filename = filePath.split('/').pop();
    var imageExts = ['.png','.jpg','.jpeg','.gif','.webp','.svg'];
    var ext = '.' + filename.split('.').pop().toLowerCase();
    // For image files, use /api/raw/ endpoint and show image preview
    if (imageExts.indexOf(ext) >= 0) {
      var rawUrl = '/api/raw/' + filePath;
      showImagePreview(filename, rawUrl);
      return;
    }
    try {
      var data = await api.get('/api/file/' + encodeURIComponent(filePath));
      showFilePreview(filename, data.content, '/api/raw/' + filePath);
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
        contentEl.innerHTML = renderMarkdown(raw);
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
    history.back();
  }

  // ── Task Prev/Next Navigation ─────────────────
  function navigateTask(direction) {
    var tasks = state.tasks || [];
    // Filter to pending_approval tasks only for quick review flow
    var pending = tasks.filter(function(t) { return t.status === 'pending_approval'; });
    var list = pending.length > 1 ? pending : tasks;
    if (list.length < 2) return;
    var currentId = state.currentTaskId;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === currentId) { idx = i; break; }
    }
    // If current task not in pending list, jump to first pending
    if (idx === -1) {
      openTask(list[0].id);
      return;
    }
    var nextIdx;
    if (direction === 'prev') {
      nextIdx = (idx - 1 + list.length) % list.length;
    } else {
      nextIdx = (idx + 1) % list.length;
    }
    openTask(list[nextIdx].id);
  }

  // Keyboard shortcuts for task navigation (left/right arrows)
  document.addEventListener('keydown', function(e) {
    if (state.currentView !== 'task-detail') return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateTask('prev'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigateTask('next'); }
  });

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
  function switchSettingsSection(sectionId) {
    var sections = document.querySelectorAll('.settings-section');
    for (var i = 0; i < sections.length; i++) {
      sections[i].classList.remove('active');
    }
    var items = document.querySelectorAll('.settings-sidebar-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('active');
    }
    var target = document.getElementById('settings-sec-' + sectionId);
    if (target) target.classList.add('active');
    var item = document.querySelector('.settings-sidebar-item[data-section="' + sectionId + '"]');
    if (item) item.classList.add('active');
    state.settingsSection = sectionId;
  }

  function renderVaultStatusBar(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    api.get('/api/secrets/status').then(function(status) {
      if (!status.exists) {
        container.className = 'vault-status-bar not-configured';
        container.innerHTML = '<span>&#9888; No vault configured yet</span>';
      } else if (status.locked) {
        container.className = 'vault-status-bar locked';
        container.innerHTML = '<span>&#128274; Vault is locked</span>';
      } else {
        container.className = 'vault-status-bar unlocked';
        container.innerHTML = '<span>&#128275; Vault unlocked</span><button class="btn btn-secondary" onclick="App.lockSecrets()" style="font-size:11px;padding:3px 10px;margin-left:auto">Lock</button>';
      }
    }).catch(function() {
      container.className = 'vault-status-bar not-configured';
      container.innerHTML = '<span>Unable to check vault status</span>';
    });
  }

  async function loadSettings() {
    try {
      var sys = await api.get('/api/system/status');
      var agents = await api.get('/api/agents');
      document.getElementById('settings-team-name').textContent = sys.teamName || '-';
      document.getElementById('settings-version').textContent = 'v' + (sys.version || '1.0.0');
      document.getElementById('settings-agent-count').textContent = (agents.agents || []).length;
    } catch(e) { console.error('Failed to load settings:', e); }
    checkClaudeStatus();
    loadPermissionMode();
    loadAccessPaths();
    checkForUpdates();
    checkSystemHealth();
    loadSecretsStatus();
    loadCredentialsStatus();
    loadTempStatus();
    loadBackupList();
    renderVaultStatusBar('vault-status-bar-secrets');
    renderVaultStatusBar('vault-status-bar-passwords');
    // Restore last active section
    if (state.settingsSection) {
      switchSettingsSection(state.settingsSection);
    }
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

  // ── Backup / Restore ──────────────────────────────
  async function createBackup() {
    var includeMedia = document.getElementById('backup-include-media')?.checked || false;
    try {
      toast('Creating backup...');
      var result = await api.post('/api/backup/create', { includeMedia: includeMedia });
      toast('Backup created (' + result.sizeMB + ' MB)');
      loadBackupList();
    } catch(e) { toast('Backup failed: ' + e.message, 'error'); }
  }

  async function loadBackupList() {
    var container = document.getElementById('backup-list');
    if (!container) return;
    try {
      var result = await api.get('/api/backup/list');
      var backups = result.backups || [];
      if (!backups.length) { container.innerHTML = '<div style="color:var(--text-muted);font-size:12px">No backups yet</div>'; return; }
      var html = '';
      for (var i = 0; i < backups.length; i++) {
        var b = backups[i];
        var date = b.manifest?.timestamp ? new Date(b.manifest.timestamp).toLocaleString() : b.id;
        var media = b.manifest?.includeMedia ? ' (with media)' : '';
        html += '<div class="backup-item">'
          + '<div class="backup-info"><span class="backup-date">' + date + '</span>'
          + '<span class="backup-meta">' + b.sizeMB + ' MB' + media + '</span></div>'
          + '<div class="backup-actions">'
          + '<button class="btn btn-secondary" onclick="App.restoreBackup(\'' + b.id + '\')">Restore</button>'
          + '<button class="btn btn-cancel" onclick="App.deleteBackup(\'' + b.id + '\')">Delete</button>'
          + '</div></div>';
      }
      container.innerHTML = html;
    } catch(e) { container.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Failed to load backups</div>'; }
  }

  async function restoreBackup(backupId) {
    var confirmed = prompt('This will overwrite current data. Type "restore" to confirm:');
    if (confirmed !== 'restore') { toast('Restore cancelled'); return; }
    try {
      toast('Restoring backup...');
      await api.post('/api/backup/restore', { backupId: backupId });
      toast('Backup restored successfully');
    } catch(e) { toast('Restore failed: ' + e.message, 'error'); }
  }

  async function deleteBackup(backupId) {
    if (!confirm('Delete this backup?')) return;
    try {
      await api.post('/api/backup/delete', { backupId: backupId });
      toast('Backup deleted');
      loadBackupList();
    } catch(e) { toast('Delete failed: ' + e.message, 'error'); }
  }

  async function rebuildContext() {
    try {
      await api.post('/api/rebuild-context', {});
      toast('CLAUDE.md rebuilt');
    } catch(e) { toast('Failed to rebuild context', 'error'); }
  }

  async function shutdownServer() {
    var ok = await confirmAction({
      title: 'Close Session',
      message: 'This will stop the portal server and close the CLI session. You will need to run launch.bat again to restart.',
      confirmLabel: 'Close Session'
    });
    if (!ok) return;
    try {
      await api.post('/api/server/shutdown', {});
    } catch(e) { /* expected - server is shutting down */ }
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#999;font-size:18px;">Session closed. You can close this tab.</div>';
  }

  async function restartServer() {
    var ok = await confirmAction({
      title: 'Restart Server',
      message: 'This will restart the portal server and CLI session. The page will automatically reconnect.',
      confirmLabel: 'Restart'
    });
    if (!ok) return;
    try {
      await api.post('/api/server/restart', {});
    } catch(e) { /* expected - server is restarting */ }
    toast('Server restarting...');
    // Wait and reload
    setTimeout(function() { location.reload(); }, 4000);
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

  // ── Local Access Paths ──────────────────────────────
  async function loadAccessPaths() {
    var container = document.getElementById('access-paths-list');
    if (!container) return;
    try {
      var result = await api.get('/api/settings/access-paths');
      var paths = result.paths || [];
      var root = result.root || '';
      container.innerHTML = paths.map(function(p) {
        var isDefault = (p === root);
        return '<div class="access-path-item">' +
          '<div class="access-path-info">' +
            '<span class="access-path-text">' + escHtml(p) + '</span>' +
            '<span class="access-path-hint">includes subfolders</span>' +
          '</div>' +
          (isDefault
            ? '<span class="access-path-default">Default</span>'
            : '<button class="access-path-remove" onclick="App.removeAccessPath(\'' + escHtml(p.replace(/'/g, "\\'")) + '\')" title="Remove">&times;</button>') +
        '</div>';
      }).join('');
    } catch(e) {
      container.innerHTML = '<div class="form-hint">Failed to load access paths</div>';
    }
  }

  async function addAccessPath() {
    var input = document.getElementById('access-path-input');
    if (!input) return;
    var p = input.value.trim();
    if (!p) { toast('Enter a folder path', 'error'); return; }
    try {
      await api.post('/api/settings/access-paths', { path: p });
      input.value = '';
      toast('Access path added');
      loadAccessPaths();
    } catch(e) { toast('Failed to add path: ' + e.message, 'error'); }
  }

  async function removeAccessPath(p) {
    if (!confirm('Remove access to ' + p + '?')) return;
    try {
      await fetch('/api/settings/access-paths', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p })
      }).then(function(res) { return res.json(); });
      toast('Access path removed');
      loadAccessPaths();
    } catch(e) { toast('Failed to remove path', 'error'); }
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
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) {
      toast('Invalid master password', 'error');
    }
  }

  async function lockSecrets() {
    try {
      await api.post('/api/secrets/lock', {});
      toast('Secrets locked');
      loadSecretsStatus();
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) { toast('Failed to lock secrets', 'error'); }
  }

  async function initializeSecrets() {
    var pw = document.getElementById('secrets-new-master-password');
    var confirm = document.getElementById('secrets-confirm-master-password');
    if (!pw || !pw.value) { toast('Enter a master password', 'error'); return; }
    if (pw.value !== confirm.value) { toast('Passwords do not match', 'error'); return; }
    if (pw.value.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
    try {
      await api.post('/api/secrets/init', { password: pw.value });
      pw.value = ''; confirm.value = '';
      toast('Vault created!');
      loadSecretsStatus();
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) { toast(e.message || 'Failed to create vault', 'error'); }
  }

  function showAddSecret() {
    var addForm = document.getElementById('secrets-add-form');
    if (addForm) addForm.classList.remove('hidden');
    document.getElementById('secret-add-name').value = '';
    document.getElementById('secret-add-value').value = '';
  }

  function cancelAddSecret() {
    document.getElementById('secrets-add-form').classList.add('hidden');
  }

  async function saveSecret() {
    var nameEl = document.getElementById('secret-add-name');
    var valueEl = document.getElementById('secret-add-value');
    var name = nameEl.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    var value = valueEl.value;
    if (!name || !value) { toast('Name and value are required', 'error'); return; }

    try {
      await api.post('/api/secrets', { name: name, value: value });
      toast('Secret saved');
      document.getElementById('secrets-add-form').classList.add('hidden');
      loadSecretsStatus();
    } catch(e) { toast(e.message || 'Failed to save secret', 'error'); }
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

  // ── Credentials Manager ──────────────────────────────
  var credentialsVaultPassword = null;

  async function loadCredentialsStatus() {
    var lockedMsg = document.getElementById('credentials-locked-msg');
    var setupForm = document.getElementById('credentials-setup-form');
    var listContainer = document.getElementById('credentials-list-container');
    var addForm = document.getElementById('credentials-add-form');
    if (!lockedMsg) return;

    lockedMsg.classList.add('hidden');
    if (setupForm) setupForm.classList.add('hidden');
    if (listContainer) listContainer.classList.add('hidden');
    if (addForm) addForm.classList.add('hidden');

    try {
      var status = await api.get('/api/secrets/status');
      if (!status.exists) {
        // No vault at all - show setup form
        if (setupForm) setupForm.classList.remove('hidden');
      } else if (status.locked) {
        // Vault exists but locked
        lockedMsg.classList.remove('hidden');
      } else {
        // Vault unlocked
        if (listContainer) listContainer.classList.remove('hidden');
        loadCredentialsList();
      }
    } catch(e) {
      lockedMsg.classList.remove('hidden');
    }
  }

  async function initializeCredentialsVault() {
    var pw = document.getElementById('credentials-new-master-password');
    var confirmPw = document.getElementById('credentials-confirm-master-password');
    if (!pw || !pw.value) { toast('Enter a master password', 'error'); return; }
    if (pw.value !== confirmPw.value) { toast('Passwords do not match', 'error'); return; }
    if (pw.value.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
    try {
      await api.post('/api/secrets/init', { password: pw.value });
      pw.value = ''; confirmPw.value = '';
      toast('Vault created!');
      loadSecretsStatus();
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) { toast(e.message || 'Failed to create vault', 'error'); }
  }

  async function loadCredentialsList() {
    var listEl = document.getElementById('credentials-list');
    if (!listEl) return;
    try {
      var data = await api.get('/api/credentials');
      if (!data.credentials || data.credentials.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No credentials stored</div>';
        return;
      }
      listEl.innerHTML = data.credentials.map(function(c) {
        return '<div class="secret-item">' +
          '<span class="secret-name">' + escHtml(c.service) + '</span>' +
          '<span class="secret-value">' + escHtml(c.username) + ' / ' + escHtml(c.maskedPassword) + '</span>' +
          '<span class="secret-actions">' +
            '<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" onclick="App.editCredential(' + q + c.service + q + ')">Edit</button>' +
            '<button class="btn btn-cancel" style="font-size:11px;padding:3px 8px" onclick="App.deleteCredential(' + q + c.service + q + ')">Delete</button>' +
          '</span>' +
        '</div>';
      }).join('');
    } catch(e) {
      listEl.innerHTML = '<div class="empty-state">Failed to load credentials</div>';
    }
  }

  var editingCredentialService = null;

  function showAddCredential() {
    editingCredentialService = null;
    var addForm = document.getElementById('credentials-add-form');
    if (addForm) addForm.classList.remove('hidden');
    document.getElementById('credential-add-service').value = '';
    document.getElementById('credential-add-service').disabled = false;
    document.getElementById('credential-add-username').value = '';
    document.getElementById('credential-add-password').value = '';
  }

  function cancelAddCredential() {
    document.getElementById('credentials-add-form').classList.add('hidden');
    editingCredentialService = null;
  }

  async function saveCredential() {
    var serviceEl = document.getElementById('credential-add-service');
    var usernameEl = document.getElementById('credential-add-username');
    var passwordEl = document.getElementById('credential-add-password');
    var service = serviceEl.value.trim();
    var username = usernameEl.value.trim();
    var password = passwordEl.value;
    if (!service || !username || !password) { toast('All fields are required', 'error'); return; }

    try {
      if (editingCredentialService) {
        await api.put('/api/credentials/' + encodeURIComponent(editingCredentialService), { username: username, password: password });
        toast('Credential updated');
      } else {
        var body = { service: service, username: username, password: password };
        if (credentialsVaultPassword) {
          body.masterPassword = credentialsVaultPassword;
          credentialsVaultPassword = null;
        }
        await api.post('/api/credentials', body);
        toast('Credential saved');
      }
      document.getElementById('credentials-add-form').classList.add('hidden');
      editingCredentialService = null;
      loadCredentialsList();
      loadSecretsStatus(); // refresh secrets panel too since vault was created
    } catch(e) { toast(e.message || 'Failed to save credential', 'error'); }
  }

  function editCredential(service) {
    editingCredentialService = service;
    var serviceEl = document.getElementById('credential-add-service');
    serviceEl.value = service;
    serviceEl.disabled = true;
    document.getElementById('credential-add-username').value = '';
    document.getElementById('credential-add-password').value = '';
    document.getElementById('credential-add-username').placeholder = 'Enter new username';
    document.getElementById('credential-add-password').placeholder = 'Enter new password';
    document.getElementById('credentials-add-form').classList.remove('hidden');
  }

  async function deleteCredential(service) {
    if (!confirm('Delete credential for "' + service + '"? This cannot be undone.')) return;
    try {
      await api.del('/api/credentials/' + encodeURIComponent(service));
      toast('Credential deleted');
      loadCredentialsList();
    } catch(e) { toast('Failed to delete credential', 'error'); }
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
      _upgradeCheckData = result; // cache for upgrade modal

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

  // Cached update check result for upgrade modal
  var _upgradeCheckData = null;

  async function performUpgrade() {
    // Open upgrade modal instead of confirm()
    try {
      var statusEl = document.getElementById('update-status');
      if (statusEl) { statusEl.textContent = 'Checking...'; statusEl.className = 'badge badge-inactive'; }

      // Fetch latest check data if not cached
      if (!_upgradeCheckData) {
        _upgradeCheckData = await api.get('/api/updates/check');
      }
      if (!_upgradeCheckData || !_upgradeCheckData.updateAvailable) {
        toast('No update available');
        return;
      }

      // Populate modal
      var fromEl = document.getElementById('upgrade-from-version');
      var toEl = document.getElementById('upgrade-to-version');
      var notesEl = document.getElementById('upgrade-release-notes');
      if (fromEl) fromEl.textContent = 'v' + (_upgradeCheckData.currentVersion || '?');
      if (toEl) toEl.textContent = 'v' + (_upgradeCheckData.latestVersion || '?');
      if (notesEl) {
        var notes = _upgradeCheckData.releaseNotes || 'No release notes available.';
        notesEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(notes) : escHtml(notes);
      }

      // Check for active tasks
      var warningEl = document.getElementById('upgrade-active-warning');
      var warningText = document.getElementById('upgrade-active-text');
      var forceCheck = document.getElementById('upgrade-force-check');
      var confirmBtn = document.getElementById('upgrade-confirm-btn');
      try {
        var tasks = await api.get('/api/tasks');
        var activeTasks = (tasks.tasks || []).filter(function(t) {
          return t.status === 'in_progress' || t.status === 'accepted';
        });
        if (activeTasks.length > 0) {
          if (warningEl) warningEl.classList.remove('hidden');
          if (warningText) warningText.textContent = activeTasks.length + ' task' + (activeTasks.length > 1 ? 's are' : ' is') + ' currently active. Upgrading may interrupt running agents.';
          if (forceCheck) forceCheck.checked = false;
          if (confirmBtn) confirmBtn.disabled = true;
        } else {
          if (warningEl) warningEl.classList.add('hidden');
          if (confirmBtn) confirmBtn.disabled = false;
        }
      } catch(e) {
        if (warningEl) warningEl.classList.add('hidden');
        if (confirmBtn) confirmBtn.disabled = false;
      }

      // Reset progress UI
      var progressContainer = document.getElementById('upgrade-progress-container');
      if (progressContainer) progressContainer.classList.add('hidden');
      var steps = document.querySelectorAll('.upgrade-progress-step');
      steps.forEach(function(s) { s.className = 'upgrade-progress-step'; s.querySelector('.step-icon').innerHTML = '&#9675;'; });
      var actionsEl = document.getElementById('upgrade-actions');
      if (actionsEl) actionsEl.style.display = '';

      // Show modal
      document.getElementById('upgrade-modal').classList.remove('hidden');
    } catch(e) {
      toast('Failed to prepare upgrade', 'error');
      console.error('Upgrade modal error:', e);
    }
  }

  function closeUpgradeModal() {
    document.getElementById('upgrade-modal').classList.add('hidden');
  }

  function toggleUpgradeBtn() {
    var forceCheck = document.getElementById('upgrade-force-check');
    var confirmBtn = document.getElementById('upgrade-confirm-btn');
    if (confirmBtn && forceCheck) {
      confirmBtn.disabled = !forceCheck.checked;
    }
  }

  async function confirmUpgrade() {
    var confirmBtn = document.getElementById('upgrade-confirm-btn');
    var cancelBtn = document.querySelector('#upgrade-actions .btn-secondary');
    var progressContainer = document.getElementById('upgrade-progress-container');
    var warningEl = document.getElementById('upgrade-active-warning');
    var forceCheck = document.getElementById('upgrade-force-check');
    var needsForce = warningEl && !warningEl.classList.contains('hidden');

    // Disable buttons, show progress
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Upgrading...'; }
    if (cancelBtn) cancelBtn.disabled = true;
    if (progressContainer) progressContainer.classList.remove('hidden');

    // Animate progress steps
    var stepNames = ['check', 'backup', 'download', 'migrate', 'rebuild', 'done'];
    var stepTimings = [400, 1200, 2500, 1500, 800, 0]; // ms delay before marking done
    var currentStep = 0;
    var upgradeFinished = false;
    var upgradeFailed = false;
    var upgradeError = '';

    function setStepState(name, state) {
      var el = document.querySelector('.upgrade-progress-step[data-step="' + name + '"]');
      if (!el) return;
      el.className = 'upgrade-progress-step ' + state;
      var icon = el.querySelector('.step-icon');
      if (state === 'active') icon.innerHTML = '&#9679;';
      else if (state === 'done') icon.innerHTML = '&#10003;';
      else if (state === 'error') icon.innerHTML = '&#10007;';
    }

    function advanceStep() {
      if (currentStep >= stepNames.length || upgradeFailed) return;
      if (currentStep > 0) setStepState(stepNames[currentStep - 1], 'done');
      setStepState(stepNames[currentStep], 'active');
      currentStep++;
      if (!upgradeFinished && currentStep < stepNames.length) {
        setTimeout(advanceStep, stepTimings[currentStep - 1]);
      }
    }

    advanceStep();

    // Fire the actual upgrade
    try {
      var body = needsForce ? { force: true } : {};
      var result = await api.post('/api/updates/upgrade', body);
      upgradeFinished = true;

      if (result.success) {
        // Mark all remaining steps as done
        for (var i = 0; i < stepNames.length; i++) {
          setStepState(stepNames[i], 'done');
        }
        toast('Upgrade complete! Server restarting...');
        var statusEl = document.getElementById('update-status');
        if (statusEl) { statusEl.textContent = 'Restart required'; statusEl.className = 'badge badge-pending'; }
        var upgradeBtn = document.getElementById('update-upgrade-btn');
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        var banner = document.getElementById('update-banner');
        if (banner) banner.classList.add('hidden');
        // Hide actions, show done message
        var actionsEl = document.getElementById('upgrade-actions');
        if (actionsEl) actionsEl.style.display = 'none';
        // Auto-close modal after a moment
        setTimeout(function() { closeUpgradeModal(); }, 2000);
      } else {
        upgradeFailed = true;
        upgradeError = result.message || 'Upgrade failed';
        // If 409 active tasks conflict
        if (result.activeTasks) {
          upgradeError = 'Blocked: ' + result.activeTasks + ' active task(s). Use force option.';
        }
        setStepState(stepNames[Math.max(0, currentStep - 1)], 'error');
        toast(upgradeError, 'error');
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Retry Upgrade'; }
        if (cancelBtn) cancelBtn.disabled = false;
      }
    } catch(e) {
      upgradeFinished = true;
      upgradeFailed = true;
      setStepState(stepNames[Math.max(0, currentStep - 1)], 'error');
      toast('Upgrade failed: ' + (e.message || 'Unknown error'), 'error');
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Retry Upgrade'; }
      if (cancelBtn) cancelBtn.disabled = false;
      console.error('Upgrade error:', e);
    }
  }

  async function silentUpdateCheck() {
    try {
      var result = await api.get('/api/updates/check');
      _upgradeCheckData = result; // cache for upgrade modal
      var banner = document.getElementById('update-banner');
      if (result.updateAvailable && banner) {
        banner.classList.remove('hidden');
      }
    } catch(e) {}
  }

  // ── Post-Upgrade Banner ────────────────────────────
  async function checkPostUpgradeBanner() {
    try {
      var status = await api.get('/api/updates/status');
      // Check upgrading lock first
      if (status.upgrading) {
        showUpgradingOverlay();
        // Poll until upgrading is done
        var pollInterval = setInterval(async function() {
          try {
            var s = await api.get('/api/updates/status');
            if (!s.upgrading) {
              clearInterval(pollInterval);
              hideUpgradingOverlay();
              checkPostUpgradeBanner();
            }
          } catch(e) {}
        }, 3000);
        return;
      }
      hideUpgradingOverlay();

      // Check for recent upgrade (within 5 minutes)
      if (status.lastUpgrade) {
        var upgradeTime = new Date(status.lastUpgrade.timestamp || status.lastUpgrade);
        var now = new Date();
        var diffMs = now - upgradeTime;
        if (diffMs < 5 * 60 * 1000) {
          var version = status.lastUpgrade.toVersion || status.lastUpgrade.version || '?';
          var migrations = status.lastUpgrade.migrationsRun || 0;
          var dismissedKey = 'upgrade-dismissed-' + version;
          if (!localStorage.getItem(dismissedKey)) {
            var textEl = document.getElementById('post-upgrade-text');
            var bannerEl = document.getElementById('post-upgrade-banner');
            if (textEl) textEl.textContent = 'Updated to v' + version + ' - ' + migrations + ' migration' + (migrations !== 1 ? 's' : '') + ' applied.';
            if (bannerEl) {
              bannerEl.classList.remove('hidden');
              bannerEl._dismissKey = dismissedKey;
            }
          }
        }
      }
    } catch(e) {
      console.error('Post-upgrade check failed:', e);
    }
  }

  function dismissUpgradeBanner() {
    var bannerEl = document.getElementById('post-upgrade-banner');
    if (bannerEl) {
      if (bannerEl._dismissKey) localStorage.setItem(bannerEl._dismissKey, '1');
      bannerEl.classList.add('hidden');
    }
  }

  // ── System Health Indicator ────────────────────────
  async function checkSystemHealth() {
    var indicator = document.getElementById('system-health-indicator');
    var details = document.getElementById('system-health-details');
    if (!indicator) return;

    try {
      var status = await api.get('/api/updates/status');

      if (status.migrationFailed) {
        indicator.innerHTML = '<span class="health-indicator health-red"><span class="health-dot"></span> Migration failed</span>';
        if (details) {
          details.className = 'health-details';
          details.innerHTML = '<div>' + escHtml(status.migrationFailed.error || 'Unknown migration error') + '</div>' +
            '<div style="margin-top:8px;display:flex;gap:8px;">' +
            '<button class="btn btn-secondary" onclick="App.retryMigrations()" style="font-size:11px;padding:3px 10px;">Retry</button>' +
            '<button class="btn btn-cancel" onclick="App.rollbackUpgrade()" style="font-size:11px;padding:3px 10px;">Rollback</button>' +
            '</div>';
        }
      } else if (status.upgrading) {
        indicator.innerHTML = '<span class="health-indicator health-yellow"><span class="health-dot"></span> Upgrade in progress or interrupted</span>';
        if (details) { details.className = 'hidden'; details.innerHTML = ''; }
      } else {
        indicator.innerHTML = '<span class="health-indicator health-green"><span class="health-dot"></span> System healthy</span>';
        if (details) { details.className = 'hidden'; details.innerHTML = ''; }
      }
    } catch(e) {
      indicator.innerHTML = '<span class="health-indicator health-yellow"><span class="health-dot"></span> Unable to check</span>';
    }
  }

  async function retryMigrations() {
    toast('Retrying migrations...');
    try {
      var result = await api.post('/api/updates/upgrade', { force: true });
      if (result.success) {
        toast('Migrations completed successfully');
        checkSystemHealth();
      } else {
        toast(result.message || 'Retry failed', 'error');
      }
    } catch(e) {
      toast('Retry failed', 'error');
    }
  }

  async function rollbackUpgrade() {
    if (!confirm('Rollback to the previous version? This will restore the backup created before the last upgrade.')) return;
    toast('Rolling back...');
    try {
      var result = await api.post('/api/updates/rollback', {});
      if (result.success) {
        toast('Rollback complete. Restart the server to apply.');
        checkSystemHealth();
      } else {
        toast(result.message || 'Rollback failed', 'error');
      }
    } catch(e) {
      toast('Rollback failed', 'error');
    }
  }

  // ── Upgrading Lock Overlay ─────────────────────────
  function showUpgradingOverlay() {
    var overlay = document.getElementById('upgrading-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function hideUpgradingOverlay() {
    var overlay = document.getElementById('upgrading-overlay');
    if (overlay) overlay.classList.add('hidden');
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
    if (VIDEO_EXTS.indexOf(ext) >= 0) return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
    if (DOC_EXTS.indexOf(ext) >= 0) return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  }

  async function loadMediaRecursive(dir, prefix) {
    var items = await api.get('/api/ls/' + dir);
    var result = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var relPath = prefix ? prefix + '/' + item.name : item.name;
      if (item.isDir) {
        var sub = await loadMediaRecursive(dir + '/' + item.name, relPath);
        result = result.concat(sub);
      } else {
        result.push({ name: relPath });
      }
    }
    return result;
  }

  async function loadMedia() {
    try {
      var mediaFiles = await loadMediaRecursive('data/media', '');
      var el = document.getElementById('media-grid');
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
        var displayName = f.name.split('/').pop();
        var truncName = displayName.length > 20 ? displayName.slice(0, 17) + '...' : displayName;
        var subdir = f.name.indexOf('/') >= 0 ? f.name.substring(0, f.name.lastIndexOf('/')) : '';
        var subdirBadge = subdir ? '<span style="font-size:10px;color:var(--text-muted);display:block;overflow:hidden;text-overflow:ellipsis">' + escHtml(subdir) + '</span>' : '';
        // Encode path segments individually to support subdirectories
        var encodedPath = f.name.split('/').map(encodeURIComponent).join('/');
        if (isImage) {
          return '<div class="media-thumb" onclick="App.openMediaPreview(\'' + escHtml(f.name.replace(/'/g, "\\'")) + '\',\'' + typeStr + '\')">' +
            '<img src="/api/media/files/' + encodedPath + '" alt="' + escHtml(f.name) + '">' +
            '<div class="media-thumb-info">' + subdirBadge + '<span class="media-thumb-name" title="' + escHtml(f.name) + '">' + escHtml(truncName) + '</span></div></div>';
        }
        return '<div class="media-thumb" onclick="App.openMediaPreview(\'' + escHtml(f.name.replace(/'/g, "\\'")) + '\',\'' + typeStr + '\')">' +
          '<div class="media-thumb-icon">' + mediaTypeIcon(ext) + '</div>' +
          '<div class="media-thumb-info">' + subdirBadge + '<span class="media-thumb-name" title="' + escHtml(f.name) + '">' + escHtml(truncName) + '</span></div></div>';
      }).join('');
    } catch(e) {
      document.getElementById('media-grid').innerHTML = '<div class="empty-state">No media files yet</div>';
    }
  }

  function openMediaPreview(filename, type) {
    state.currentMediaFile = filename;
    var content = document.getElementById('media-preview-content');
    var encodedPath = filename.split('/').map(encodeURIComponent).join('/');
    if (type === 'image') {
      content.innerHTML = '<img src="/api/media/files/' + encodedPath + '" alt="' + escHtml(filename) + '" style="max-width:100%;max-height:70vh;display:block;margin:0 auto 12px;border-radius:6px">' +
        '<p style="text-align:center;color:var(--text-muted);font-size:13px">' + escHtml(filename) + '</p>' +
        '<button onclick="App.openMediaFolder()" style="display:block;margin:8px auto 0;padding:4px 12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);cursor:pointer;font-size:12px">Open Location</button>';
    } else {
      var ext = filename.split('.').pop().toLowerCase();
      var icon = mediaTypeIcon(ext);
      content.innerHTML = '<div style="text-align:center;padding:32px">' +
        '<div style="font-size:64px;margin-bottom:16px">' + icon + '</div>' +
        '<p style="font-size:16px;font-weight:500;margin-bottom:8px">' + escHtml(filename) + '</p>' +
        '<p style="color:var(--text-muted);font-size:13px">Type: ' + escHtml(ext.toUpperCase()) + '</p>' +
        '<button onclick="App.openMediaFolder()" style="display:block;margin:12px auto 0;padding:4px 12px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);cursor:pointer;font-size:12px">Open Location</button></div>';
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

    // Handle copy (Ctrl+C with selection) and paste (Ctrl+V)
    terminal.attachCustomKeyEventHandler(function(ev) {
      if (ev.type === 'keydown' && ev.ctrlKey && ev.key === 'c' && terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection()).catch(function() {});
        return false;
      }
      if (ev.type === 'keydown' && ev.ctrlKey && ev.key === 'v') {
        navigator.clipboard.readText().then(function(text) {
          if (text && termWs && termWs.readyState === 1) {
            termWs.send(JSON.stringify({ type: 'input', data: text }));
          }
        }).catch(function() {});
        return false;
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
    var imageExts = ['png','jpg','jpeg','gif','webp','svg'];
    // Convert URLs to clickable links that open in new tab
    return text.replace(/(https?:\/\/[^\s<&]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>')
      .replace(/((?:data|temp)\/[^\s<&]+\.(md|txt|json|html|pdf|png|jpg|jpeg|gif|svg|webp|mp4|csv))/gi, function(match) {
        var ext = match.split('.').pop().toLowerCase();
        if (imageExts.indexOf(ext) >= 0) {
          return '<a href="/api/raw/' + match + '" target="_blank" style="color:var(--accent)">' + match + '</a>';
        }
        return '<a href="#" onclick="App.viewFile(\'' + match.replace(/'/g, "\\'") + '\');return false;" style="color:var(--accent)">' + match + '</a>';
      });
  }

  // ── Depends-On Chip Input ───────────────────────────
  function renderDepsChips() {
    var wrap = document.getElementById('add-task-depends-wrap');
    if (!wrap) return;
    var input = wrap.querySelector('.tag-input-field');
    wrap.querySelectorAll('.tag-badge-removable').forEach(function(el) { el.remove(); });
    (state._addTaskDeps || []).forEach(function(depId) {
      var task = (state._addTaskDepsList || []).find(function(t) { return t.id === depId; });
      var label = task ? task.title.substring(0, 30) + (task.title.length > 30 ? '...' : '') : depId;
      var span = document.createElement('span');
      span.className = 'tag-badge tag-badge-removable';
      span.style.color = 'var(--accent)';
      span.innerHTML = escHtml(label) + '<span class="tag-remove">x</span>';
      span.onclick = function() {
        state._addTaskDeps = state._addTaskDeps.filter(function(d) { return d !== depId; });
        renderDepsChips();
      };
      wrap.insertBefore(span, input);
    });
  }

  function showDepsAutocomplete(query) {
    var ac = document.getElementById('add-task-depends-autocomplete');
    if (!ac) return;
    var selected = state._addTaskDeps || [];
    var matches = (state._addTaskDepsList || []).filter(function(t) {
      if (selected.indexOf(t.id) !== -1) return false;
      if (!query) return true;
      return t.title.toLowerCase().indexOf(query.toLowerCase()) !== -1;
    });
    if (matches.length === 0) { ac.classList.remove('open'); return; }
    ac.innerHTML = matches.slice(0, 8).map(function(t) {
      return '<div class="tag-autocomplete-item" onmousedown="App.selectDep(\'' + t.id + '\')">' + escHtml(t.title.substring(0, 50)) + '</div>';
    }).join('');
    ac.classList.add('open');
  }

  function selectDep(taskId) {
    if (state._addTaskDeps.indexOf(taskId) === -1) {
      state._addTaskDeps.push(taskId);
      renderDepsChips();
    }
    var input = document.getElementById('add-task-depends-input');
    if (input) input.value = '';
    var ac = document.getElementById('add-task-depends-autocomplete');
    if (ac) ac.classList.remove('open');
  }

  // ── Tag System ──────────────────────────────────────
  var TAG_COLORS = [
    { bg: 'rgba(110,180,230,0.10)', text: '#6ab0d8' },
    { bg: 'rgba(180,130,220,0.10)', text: '#a890c8' },
    { bg: 'rgba(130,200,150,0.10)', text: '#88c090' },
    { bg: 'rgba(220,170,90,0.10)', text: '#c0a058' },
    { bg: 'rgba(220,120,120,0.10)', text: '#c88080' },
    { bg: 'rgba(120,200,200,0.10)', text: '#80b8b8' },
    { bg: 'rgba(200,160,120,0.10)', text: '#b09068' },
    { bg: 'rgba(160,180,220,0.10)', text: '#90a0c8' },
    { bg: 'rgba(220,160,180,0.10)', text: '#c890a0' },
    { bg: 'rgba(180,200,100,0.10)', text: '#a0b060' },
    { bg: 'rgba(200,140,200,0.10)', text: '#b880b8' },
    { bg: 'rgba(140,190,180,0.10)', text: '#80b0a0' },
  ];

  function hashTagColor(tag) {
    var hash = 0;
    for (var i = 0; i < tag.length; i++) {
      hash = ((hash << 5) - hash) + tag.charCodeAt(i);
      hash |= 0;
    }
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  }

  function renderTagPill(tag) {
    var c = hashTagColor(tag);
    return '<span class="task-tag-pill" style="background:' + c.bg + ';color:' + c.text + '">' + escHtml(tag) + '</span>';
  }

  function renderTagBadge(tag) {
    var c = hashTagColor(tag);
    return '<span class="tag-badge" style="color:' + c.text + '">' + escHtml(tag) + '</span>';
  }

  function renderRemovableTag(tag, containerId) {
    var c = hashTagColor(tag);
    return '<span class="tag-badge tag-badge-removable" style="color:' + c.text + '" onclick="App.removeTag(\'' + escHtml(containerId) + '\',\'' + escHtml(tag).replace(/'/g, "\\'") + '\')">' +
      escHtml(tag) + '<span class="tag-remove">x</span></span>';
  }

  // Collect all unique tags across tasks
  function getAllUsedTags() {
    var tagSet = {};
    (state.tasks || []).forEach(function(t) {
      (t.tags || []).forEach(function(tag) { tagSet[tag] = true; });
    });
    // Also check cached detail tasks which have full tag data
    (state.cachedDashboardTasks || []).forEach(function(t) {
      (t.tags || []).forEach(function(tag) { tagSet[tag] = true; });
    });
    (state.cachedAgentTasks || []).forEach(function(t) {
      (t.tags || []).forEach(function(tag) { tagSet[tag] = true; });
    });
    return Object.keys(tagSet).sort();
  }

  // Tag input state per container
  var tagInputState = {};

  function initTagInput(containerId, initialTags) {
    tagInputState[containerId] = { tags: (initialTags || []).slice() };
    renderTagInputTags(containerId);
    var input = document.querySelector('#' + containerId + ' .tag-input-field');
    var autocomplete = document.querySelector('#' + containerId + ' .tag-autocomplete');
    if (!input || !autocomplete) return;

    // Remove old listeners by replacing node
    var newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    input = newInput;

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addTagFromInput(containerId);
      }
      if (e.key === 'Backspace' && !input.value) {
        var tags = tagInputState[containerId].tags;
        if (tags.length > 0) {
          tags.pop();
          renderTagInputTags(containerId);
        }
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateAutocomplete(containerId, e.key === 'ArrowDown' ? 1 : -1);
      }
    });
    input.addEventListener('input', function() {
      showTagAutocomplete(containerId, input.value.trim());
    });
    input.addEventListener('blur', function() {
      setTimeout(function() { autocomplete.classList.remove('open'); }, 150);
    });
    input.addEventListener('focus', function() {
      if (input.value.trim()) showTagAutocomplete(containerId, input.value.trim());
    });
  }

  function addTagFromInput(containerId) {
    var input = document.querySelector('#' + containerId + ' .tag-input-field');
    var autocomplete = document.querySelector('#' + containerId + ' .tag-autocomplete');
    if (!input) return;

    // Check if there's an active autocomplete item
    var activeItem = autocomplete ? autocomplete.querySelector('.tag-autocomplete-item.active') : null;
    var val = activeItem ? activeItem.textContent.trim() : input.value.replace(/,/g, '').trim();
    if (!val) return;

    var tags = tagInputState[containerId].tags;
    var lower = val.toLowerCase();
    if (!tags.some(function(t) { return t.toLowerCase() === lower; })) {
      tags.push(val);
      renderTagInputTags(containerId);
    }
    input.value = '';
    if (autocomplete) autocomplete.classList.remove('open');
  }

  function removeTag(containerId, tag) {
    var tags = tagInputState[containerId].tags;
    tagInputState[containerId].tags = tags.filter(function(t) { return t !== tag; });
    renderTagInputTags(containerId);
  }

  function renderTagInputTags(containerId) {
    var wrap = document.querySelector('#' + containerId + ' .tag-input-wrap');
    if (!wrap) return;
    var input = wrap.querySelector('.tag-input-field');
    // Remove old tag badges
    wrap.querySelectorAll('.tag-badge-removable').forEach(function(el) { el.remove(); });
    var tags = tagInputState[containerId].tags;
    tags.forEach(function(tag) {
      var span = document.createElement('span');
      span.innerHTML = renderRemovableTag(tag, containerId);
      wrap.insertBefore(span.firstChild, input);
    });
  }

  function showTagAutocomplete(containerId, query) {
    var autocomplete = document.querySelector('#' + containerId + ' .tag-autocomplete');
    if (!autocomplete) return;
    var allTags = getAllUsedTags();
    var currentTags = tagInputState[containerId].tags;
    var filtered = allTags.filter(function(tag) {
      if (currentTags.some(function(t) { return t.toLowerCase() === tag.toLowerCase(); })) return false;
      if (!query) return true;
      return tag.toLowerCase().indexOf(query.toLowerCase()) !== -1;
    });
    if (filtered.length === 0 || !query) {
      autocomplete.classList.remove('open');
      return;
    }
    autocomplete.innerHTML = filtered.slice(0, 8).map(function(tag) {
      var c = hashTagColor(tag);
      return '<div class="tag-autocomplete-item" style="color:' + c.text + '" onmousedown="App.selectAutoTag(\'' + escHtml(containerId) + '\',\'' + escHtml(tag).replace(/'/g, "\\'") + '\')">' + escHtml(tag) + '</div>';
    }).join('');
    autocomplete.classList.add('open');
  }

  function selectAutoTag(containerId, tag) {
    var tags = tagInputState[containerId].tags;
    var lower = tag.toLowerCase();
    if (!tags.some(function(t) { return t.toLowerCase() === lower; })) {
      tags.push(tag);
      renderTagInputTags(containerId);
    }
    var input = document.querySelector('#' + containerId + ' .tag-input-field');
    if (input) input.value = '';
    var autocomplete = document.querySelector('#' + containerId + ' .tag-autocomplete');
    if (autocomplete) autocomplete.classList.remove('open');
  }

  function navigateAutocomplete(containerId, dir) {
    var autocomplete = document.querySelector('#' + containerId + ' .tag-autocomplete');
    if (!autocomplete || !autocomplete.classList.contains('open')) return;
    var items = autocomplete.querySelectorAll('.tag-autocomplete-item');
    if (items.length === 0) return;
    var current = autocomplete.querySelector('.tag-autocomplete-item.active');
    var idx = -1;
    if (current) {
      items.forEach(function(item, i) { if (item === current) idx = i; });
      current.classList.remove('active');
    }
    idx += dir;
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    items[idx].classList.add('active');
  }

  function getTagInputTags(containerId) {
    return tagInputState[containerId] ? tagInputState[containerId].tags.slice() : [];
  }

  // Tag filter state
  state.dashboardTagFilters = [];
  state.agentTagFilters = [];

  function renderTagFilterBar(context) {
    var barId = context === 'dashboard' ? 'dashboard-tag-filter' : 'agent-tag-filter';
    var bar = document.getElementById(barId);
    if (!bar) return;

    var tasks = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;
    var tagCounts = {};
    (tasks || []).forEach(function(t) {
      (t.tags || []).forEach(function(tag) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    // Sort by frequency (most used first)
    var tagNames = Object.keys(tagCounts).sort(function(a, b) { return tagCounts[b] - tagCounts[a]; });
    if (tagNames.length === 0) { bar.innerHTML = ''; return; }

    var activeFilters = context === 'dashboard' ? state.dashboardTagFilters : state.agentTagFilters;

    // Toggle button for tag pill visibility
    var toggleLabel = state.tagsVisible ? 'Tags' : 'Tags';
    var toggleClass = state.tagsVisible ? ' active' : '';
    var html = '<span class="tag-visibility-toggle' + toggleClass + '" onclick="App.toggleTagVisibility()" title="Show/hide tag pills on tasks">' +
      '<span class="tag-vis-icon">&#9868;</span> ' + toggleLabel + '</span>';

    // Show top 10 tags (plus any active filters outside top 10)
    var visibleTags = tagNames.slice(0, 10);
    var extraTags = tagNames.slice(10);
    // Ensure active filters are always visible
    activeFilters.forEach(function(af) {
      if (visibleTags.indexOf(af) === -1 && extraTags.indexOf(af) !== -1) {
        visibleTags.push(af);
        extraTags = extraTags.filter(function(t) { return t !== af; });
      }
    });

    visibleTags.forEach(function(tag) {
      var c = hashTagColor(tag);
      var isActive = activeFilters.indexOf(tag) !== -1;
      html += '<span class="tag-filter-chip' + (isActive ? ' active' : '') + '" style="background:' + c.bg + ';color:' + c.text + '" onclick="App.toggleTagFilter(\'' + escHtml(tag).replace(/'/g, "\\'") + '\',\'' + context + '\')">' +
        escHtml(tag) + ' <span class="tag-count">' + tagCounts[tag] + '</span><span class="chip-x">x</span></span>';
    });

    // "+N more" expander for remaining tags
    if (extraTags.length > 0) {
      if (state.tagFilterExpanded) {
        extraTags.forEach(function(tag) {
          var c = hashTagColor(tag);
          var isActive = activeFilters.indexOf(tag) !== -1;
          html += '<span class="tag-filter-chip' + (isActive ? ' active' : '') + '" style="background:' + c.bg + ';color:' + c.text + '" onclick="App.toggleTagFilter(\'' + escHtml(tag).replace(/'/g, "\\'") + '\',\'' + context + '\')">' +
            escHtml(tag) + ' <span class="tag-count">' + tagCounts[tag] + '</span><span class="chip-x">x</span></span>';
        });
        html += '<button class="tag-filter-clear" onclick="App.toggleTagFilterExpand()">Show less</button>';
      } else {
        html += '<button class="tag-filter-more" onclick="App.toggleTagFilterExpand()">+' + extraTags.length + ' more</button>';
      }
    }

    if (activeFilters.length > 0) {
      html += '<button class="tag-filter-clear" onclick="App.clearTagFilters(\'' + context + '\')">Clear filters</button>';
    }
    bar.innerHTML = html;
  }

  function toggleTagFilter(tag, context) {
    var filters = context === 'dashboard' ? state.dashboardTagFilters : state.agentTagFilters;
    var idx = filters.indexOf(tag);
    if (idx !== -1) {
      filters.splice(idx, 1);
    } else {
      filters.push(tag);
    }
    renderTagFilterBar(context);
    renderFilteredTasks(context);
  }

  function clearTagFilters(context) {
    if (context === 'dashboard') {
      state.dashboardTagFilters = [];
    } else {
      state.agentTagFilters = [];
    }
    renderTagFilterBar(context);
    renderFilteredTasks(context);
  }

  function toggleTagVisibility() {
    state.tagsVisible = !state.tagsVisible;
    localStorage.setItem('tagsVisible', state.tagsVisible ? 'true' : 'false');
    renderFilteredTasks('dashboard');
    renderFilteredTasks('agent');
    renderTagFilterBar('dashboard');
    renderTagFilterBar('agent');
  }

  function toggleTagFilterExpand() {
    state.tagFilterExpanded = !state.tagFilterExpanded;
    renderTagFilterBar('dashboard');
    renderTagFilterBar('agent');
  }

  // ── Agent Filter Bar ─────────────────────────────────
  function renderAgentFilterBar(context) {
    var barId = context === 'dashboard' ? 'dashboard-agent-filter' : 'agent-agent-filter';
    var bar = document.getElementById(barId);
    if (!bar) return;

    var tasks = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;
    var agentIds = {};
    (tasks || []).forEach(function(t) {
      if (t.assignedTo) agentIds[t.assignedTo] = (agentIds[t.assignedTo] || 0) + 1;
    });
    var ids = Object.keys(agentIds).sort();
    if (ids.length <= 1) { bar.innerHTML = ''; return; }

    var activeFilter = context === 'dashboard' ? state.dashboardAgentFilter : state.agentAgentFilter;
    var html = '';
    ids.forEach(function(agentId) {
      var found = state.agents.find(function(a) { return a.id === agentId; });
      var name = found ? found.name : agentId;
      var isActive = activeFilter === agentId;
      html += '<span class="agent-filter-chip' + (isActive ? ' active' : '') + '" onclick="App.toggleAgentFilter(\'' + escHtml(agentId).replace(/'/g, "\\'") + '\',\'' + context + '\')">' +
        escHtml(name) + '</span>';
    });
    if (activeFilter) {
      html += '<button class="agent-filter-clear" onclick="App.clearAgentFilter(\'' + context + '\')">Clear</button>';
    }
    bar.innerHTML = html;
  }

  function toggleAgentFilter(agentId, context) {
    if (context === 'dashboard') {
      state.dashboardAgentFilter = state.dashboardAgentFilter === agentId ? null : agentId;
    } else {
      state.agentAgentFilter = state.agentAgentFilter === agentId ? null : agentId;
    }
    renderAgentFilterBar(context);
    renderFilteredTasks(context);
  }

  function clearAgentFilter(context) {
    if (context === 'dashboard') {
      state.dashboardAgentFilter = null;
    } else {
      state.agentAgentFilter = null;
    }
    renderAgentFilterBar(context);
    renderFilteredTasks(context);
  }

  // ── Init ───────────────────────────────────────────
  async function init() {
    connectWebSocket();

    // Prevent hints-bar buttons from stealing terminal focus
    var hintsBar = document.querySelector('.terminal-hints-bar');
    if (hintsBar) {
      hintsBar.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON') e.preventDefault();
      });
    }

    try {
      var sys = await api.get('/api/system/status');
      if (!sys.initialized) {
        document.getElementById('wizard-overlay').classList.remove('hidden');
        updateWizardStep();
      } else {
        updateSidebarHeader(sys.teamName);
        await loadSidebarAgents();
        // Deep link: navigate from hash or default to chat
        if (location.hash && location.hash !== '#') {
          _navigateFromHash();
        } else {
          navigate('chat');
        }
        // Check for updates silently on startup
        silentUpdateCheck();
        // Check post-upgrade banner and upgrading lock
        checkPostUpgradeBanner();
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
        (s.id === 'github' && s.enabled ? '<div class="github-status-panel" id="github-status-panel"><span class="text-muted">Checking connection...</span></div>' : '') +
        '<div class="skill-card-footer">' +
          '<span class="skill-type-badge skill-type-' + s.type + '">' + s.type + '</span>' +
          '<span class="skill-status ' + statusClass + '">' + statusText + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    // Load GitHub status if enabled
    var ghCard = document.getElementById('github-status-panel');
    if (ghCard) loadGitHubStatus();
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

  async function loadGitHubStatus() {
    var panel = document.getElementById('github-status-panel');
    if (!panel) return;
    try {
      var data = await api.get('/api/skills/github/status');
      var html = '<div class="github-status-row">';
      if (!data.installed) {
        html += '<span class="status-dot red"></span> gh CLI not installed - run <code>winget install GitHub.cli</code>';
      } else if (!data.authenticated) {
        html += '<span class="status-dot red"></span> Not authenticated - run <code>gh auth login</code>';
      } else {
        html += '<span class="status-dot green"></span> Connected as <strong>' + escHtml(data.user || 'unknown') + '</strong>';
      }
      html += '</div>';
      if (data.authenticated && data.repo) {
        html += '<div class="github-status-row"><span class="status-dot green"></span> Repo: <strong>' + escHtml(data.repo.owner ? data.repo.owner.login + '/' + data.repo.name : '') + '</strong></div>';
      } else if (data.authenticated && data.repoError) {
        html += '<div class="github-status-row"><span class="status-dot red"></span> ' + escHtml(data.repoError) + '</div>';
      }
      panel.innerHTML = html;
    } catch(e) {
      panel.innerHTML = '<span class="text-muted">Failed to check status</span>';
    }
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
        html += '<tr' + (isPaused ? ' class="ap-disabled"' : '') + '>' +
          '<td><a href="#" onclick="App.openTask(\'' + task.id + '\');return false" style="color:var(--text-primary);text-decoration:underline">' + escHtml(task.title) + '</a></td>' +
          '<td>' + escHtml(agentName) + '</td>' +
          '<td>' + interval + '</td>' +
          '<td>' + lastRun + '</td>' +
          '<td>' + nextRun + '</td>' +
          '<td>' + statusLabel + (task.runCount ? ' (#' + task.runCount + ')' : '') + '</td>' +
          '<td class="ap-controls">' +
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
    await populateAutopilotAgents();
    document.getElementById('autopilot-form').classList.remove('hidden');
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
  });

  async function saveAutopilot() {
    var name = document.getElementById('ap-name').value.trim();
    var prompt = document.getElementById('ap-prompt').value.trim();
    var agentId = document.getElementById('ap-agent').value;
    var intervalNum = parseInt(document.getElementById('ap-interval').value) || 1;
    var unit = document.getElementById('ap-interval-unit').value;

    if (!name || !prompt) { toast('Name and prompt are required', 'error'); return; }

    try {
      if (autopilotEditId) {
        // Update existing task's interval fields
        await api.put('/api/tasks/' + autopilotEditId, {
          title: name,
          description: prompt,
          assignedTo: agentId,
          interval: intervalNum,
          intervalUnit: unit
        });
        toast('Recurring task updated');
      } else {
        // Create new task with autopilot + interval
        await api.post('/api/tasks', {
          title: name,
          description: prompt,
          assignedTo: agentId,
          status: 'planning',
          autopilot: true,
          interval: intervalNum,
          intervalUnit: unit
        });
        toast('Recurring task created');
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
      // One-time autopilot tasks: autopilot=true but NO interval
      var tasks = (tasksData.tasks || []).filter(function(t) {
        return t.autopilot && !t.interval && t.status !== 'closed' && t.status !== 'done' && t.status !== 'cancelled';
      });
      if (tasks.length === 0) {
        container.innerHTML = '<div class="empty-state">No active one-time autopilot tasks</div>';
        return;
      }
      var html = '';
      tasks.forEach(function(t) {
        html += renderTaskCard(t, 'dashboard', false, 0);
      });
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

  // ── Help Section ─────────────────────────────────────
  var helpTopics = [
    {
      title: 'How TeamHero Works',
      icon: '&#9733;',
      content: '<h2>How TeamHero Works</h2>' +
        '<p>TeamHero is an <strong>AI agent team management platform</strong>. You manage a team of AI agents the same way you' + q + 'd manage a team of people - by assigning work, reviewing results, and giving feedback.</p>' +
        '<h3>The Three Layers</h3>' +
        '<ol>' +
        '<li><strong>You (the Owner)</strong> - You set goals, review deliverables, and provide feedback. You talk to the orchestrator through the Command Center.</li>' +
        '<li><strong>The Orchestrator (Hero)</strong> - Your team lead. It takes your instructions, breaks them into tasks, assigns them to the right agents, and makes sure work gets done. It never does the work itself - it delegates.</li>' +
        '<li><strong>Agents (the Team)</strong> - Specialized AI workers, each with their own role, personality, and memory. A developer, a researcher, a content writer - whatever your project needs.</li>' +
        '</ol>' +
        '<h3>The Workflow</h3>' +
        '<ol>' +
        '<li>You tell the orchestrator what you need in the Command Center</li>' +
        '<li>The orchestrator creates tasks and assigns them to agents</li>' +
        '<li>Agents do the work and submit it for your review</li>' +
        '<li>You accept good work or send feedback to improve it</li>' +
        '<li>Accepted work is closed automatically</li>' +
        '</ol>' +
        '<p>Think of it as a project management tool where your employees are AI agents that work instantly, 24/7, and get better over time.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'chat\')">Go to Command Center &#8594;</button>'
    },
    {
      title: 'Command Center',
      icon: '&#9654;',
      content: '<h2>Command Center</h2>' +
        '<p>The Command Center is your <strong>terminal interface</strong> to the orchestrator. This is where you give instructions, ask questions, and manage your team. Everything starts here.</p>' +
        '<h3>What You Can Do</h3>' +
        '<ul>' +
        '<li><code>Run a round table</code> - Trigger a full team review. The orchestrator will close completed work, launch agents on pending tasks, surface blockers, and give you a status report.</li>' +
        '<li><code>Create a task for Dev to build a login page</code> - Create and assign work directly to an agent.</li>' +
        '<li><code>Build me a team with a Content Writer and a QA Tester</code> - Create multiple agents at once.</li>' +
        '<li><code>What is Scout working on?</code> - Check any agent' + q + 's current status.</li>' +
        '<li><code>Research competitor pricing</code> - The orchestrator decides which agent is best and delegates.</li>' +
        '</ul>' +
        '<h3>Tips</h3>' +
        '<ul>' +
        '<li>Be specific about what you want - the orchestrator delegates to the right agent</li>' +
        '<li>You can reference agents by name</li>' +
        '<li>The orchestrator never does agent work itself - it always delegates via tasks</li>' +
        '<li>Use <strong>Ctrl+C</strong> to copy selected text, <strong>Ctrl+V</strong> to paste text, <strong>Ctrl+G</strong> to open an editor for multiline input</li>' +
        '</ul>' +
        '<button class="help-go-link" onclick="App.navigate(\'chat\')">Go to Command Center &#8594;</button>'
    },
    {
      title: 'Dashboard & Views',
      icon: '&#9632;',
      content: '<h2>Dashboard &amp; Views</h2>' +
        '<p>The Dashboard is your <strong>mission control</strong>. It shows all tasks, their statuses, and the latest round table summary. It defaults to showing <strong>Active</strong> tasks - all non-closed work across the team.</p>' +
        '<h3>Stat Cards</h3>' +
        '<p>Click any stat card to filter: <strong>Active</strong>, <strong>Pending</strong>, <strong>Working</strong>, <strong>Accepted</strong>, or <strong>Closed</strong>. The pending count includes subtasks so nothing slips through.</p>' +
        '<h3>View Modes</h3>' +
        '<ul>' +
        '<li><strong>Tree</strong> (default) - Hierarchical view showing parent tasks with their subtasks nested below. Expandable/collapsible.</li>' +
        '<li><strong>Flow</strong> - Visual dependency graph showing how tasks connect. Nodes pulse when in progress, dim when done, glow when pending. Hover any node to highlight its upstream and downstream chain.</li>' +
        '</ul>' +
        '<h3>Agent Filter Bar</h3>' +
        '<p>The filter bar above the task list lets you <strong>filter tasks by agent</strong>. Click an agent name to show only their tasks. Click again to clear the filter. This works across all view modes.</p>' +
        '<h3>Agent Tooltip</h3>' +
        '<p>Hover over any agent name in the sidebar to see a <strong>tooltip with their role description</strong>. A quick way to remember who does what without opening the agent page.</p>' +
        '<h3>Round Table Summary</h3>' +
        '<p>The right panel shows the latest round table report - what was executed, what needs your attention, and overall team status.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">Go to Dashboard &#8594;</button>'
    },
    {
      title: 'Tasks & Lifecycle',
      icon: '&#9998;',
      content: '<h2>Tasks &amp; Lifecycle</h2>' +
        '<p>Tasks are <strong>work units</strong> assigned to agents. Every piece of work flows through a clear lifecycle so nothing gets lost.</p>' +
        '<h3>Status Flow</h3>' +
        '<p><strong>Working &rarr; Pending &rarr; Accepted/Improve &rarr; Working &rarr; Closed</strong></p>' +
        '<ul>' +
        '<li><strong>Working</strong> - Agent is actively doing work. When a task is created, the agent begins immediately by preparing a plan or draft.</li>' +
        '<li><strong>Pending</strong> - Agent submitted work for your review. You can <strong>Accept</strong> or <strong>Improve</strong>.</li>' +
        '<li><strong>Accepted</strong> - You approved the work. The orchestrator launches the agent to execute, then closes it automatically.</li>' +
        '<li><strong>Improve</strong> - You sent feedback. The agent revises and resubmits to Pending.</li>' +
        '<li><strong>Closed</strong> - Done. Terminal state. No further work.</li>' +
        '<li><strong>Hold</strong> - Paused. Agent will not touch it until released.</li>' +
        '<li><strong>Cancelled</strong> - Abandoned. No further action.</li>' +
        '</ul>' +
        '<h3>Two-Phase Pending Flow</h3>' +
        '<p>A task goes through <strong>Pending twice</strong>:</p>' +
        '<ol>' +
        '<li><strong>First Pending (Plan/Draft)</strong> - The agent prepares materials, a plan, or a draft and submits for review. You review the approach before any execution happens.</li>' +
        '<li><strong>Second Pending (Proof)</strong> - After you accept, the agent executes the approved work and submits proof (URLs, file paths, test results). You verify the outcome and the task closes.</li>' +
        '</ol>' +
        '<p>This ensures you always see what will be done before it happens, and verify the results after.</p>' +
        '<h3>Inline Improve</h3>' +
        '<p>When previewing a deliverable file or image, you can click <strong>Improve</strong> directly from the preview modal. Type your feedback right there - no need to go back to the task page first.</p>' +
        '<h3>Confirmation Dialogs</h3>' +
        '<p>Both <strong>Accept</strong> and <strong>Improve</strong> now show a confirmation dialog before executing. This prevents accidental clicks and gives you a chance to add feedback text for Improve.</p>' +
        '<h3>Auto-Trigger</h3>' +
        '<p>When you click Accept or Improve, the orchestrator is <strong>immediately notified</strong> via the CLI. You do not need to run a round table or manually tell it - the agent picks up the work right away.</p>' +
        '<h3>Subtasks &amp; Dependencies</h3>' +
        '<p>Tasks can have subtasks assigned to different agents, and tasks can depend on other tasks. When all subtasks are done, the parent auto-advances. Blocked tasks (waiting on dependencies) show a lock icon.</p>' +
        '<p>Use subtasks when a goal requires <strong>multiple agents or phases</strong>. For example, a launch campaign might have a research subtask (Scout), a content subtask (Pen), and a development subtask (Dev). The parent task tracks the overall goal while subtasks track individual contributions.</p>' +
        '<h3>Autopilot Mode</h3>' +
        '<p>Individual tasks can be set to autopilot - the agent delivers, the orchestrator auto-accepts, and the task closes without your review. Toggle it on the task detail page.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">View Tasks &#8594;</button>'
    },
    {
      title: 'Round Tables',
      icon: '&#9679;',
      content: '<h2>Round Tables</h2>' +
        '<p>Round Tables are <strong>execution-first team reviews</strong>. They are the heartbeat of your team - run them regularly to keep work moving.</p>' +
        '<h3>What Happens (In Order)</h3>' +
        '<p><strong>Phase 1: Execute</strong> - The orchestrator acts before it reports:</p>' +
        '<ul>' +
        '<li>Closes all accepted tasks immediately</li>' +
        '<li>Launches agents on tasks that have your feedback (improve status)</li>' +
        '<li>Starts agents on any ready tasks that haven' + q + 't been picked up</li>' +
        '<li>Flags stalled work with no recent progress</li>' +
        '</ul>' +
        '<p><strong>Phase 2: Surface Blockers</strong></p>' +
        '<ul>' +
        '<li>Tasks stuck waiting on unmet dependencies</li>' +
        '<li>Tasks with no recent progress that may be stalled</li>' +
        '<li>Tasks that need your decision (pending review)</li>' +
        '<li>Agents with no active tasks (available capacity)</li>' +
        '</ul>' +
        '<p><strong>Phase 3: Report</strong></p>' +
        '<ul>' +
        '<li>Brief summary of what was just executed</li>' +
        '<li>What needs your decision</li>' +
        '<li>Knowledge base review - stale docs flagged</li>' +
        '</ul>' +
        '<h3>How to Trigger</h3>' +
        '<p>Type <code>Run a round table</code> in the Command Center, or click the <strong>Round Table</strong> button on the Dashboard or Command Center header.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'dashboard\')">Go to Dashboard &#8594;</button>'
    },
    {
      title: 'Agents',
      icon: '&#9670;',
      content: '<h2>Agents</h2>' +
        '<p>Agents are <strong>AI team members</strong>. Each has a distinct role, personality, rules, and memory. They execute tasks autonomously and improve over time as they learn your preferences.</p>' +
        '<h3>Agent Properties</h3>' +
        '<ul>' +
        '<li><strong>Role</strong> - Their job title and area of expertise (e.g. Full-Stack Developer, Researcher)</li>' +
        '<li><strong>Personality</strong> - Traits, tone, and communication style that shape their output</li>' +
        '<li><strong>Rules</strong> - Guidelines specific to this agent' + q + 's domain</li>' +
        '<li><strong>Capabilities</strong> - Skills and tools they can use</li>' +
        '</ul>' +
        '<h3>Agent Memory</h3>' +
        '<p>Each agent has two memory banks that persist across conversations:</p>' +
        '<ul>' +
        '<li><strong>Short Memory</strong> - Current context, active work, and recent round table outcomes. Gets refreshed regularly.</li>' +
        '<li><strong>Long Memory</strong> - Persistent knowledge, your preferences, and lessons learned over time.</li>' +
        '</ul>' +
        '<h3>The Orchestrator</h3>' +
        '<p>The orchestrator (Hero) is a special agent that manages the team. It never does work itself - it plans, delegates, coordinates, and reports. You talk to it through the Command Center, and it talks to agents via tasks.</p>' +
        '<h3>Creating Agents</h3>' +
        '<p>Use the Add Agent page, or ask the orchestrator: <code>Build me a team with a Content Writer, a QA Tester, and a Designer</code></p>' +
        '<button class="help-go-link" onclick="App.navigate(\'add-agent\')">Add New Agent &#8594;</button>'
    },
    {
      title: 'Autopilot',
      icon: '&#9881;',
      content: '<h2>Autopilot</h2>' +
        '<p>Autopilot enables <strong>autonomous task execution</strong> - work that runs without your review in the loop.</p>' +
        '<h3>Two Types of Autopilot</h3>' +
        '<p><strong>1. Task-level autopilot</strong> - Toggle autopilot on any individual task. The agent delivers, the orchestrator auto-accepts and closes. No owner review needed. Good for routine or low-risk work.</p>' +
        '<p><strong>2. Scheduled autopilot</strong> - Create recurring schedules that fire automatically on an interval. Assign a prompt to an agent, set how often it runs (minutes, hours, days), and let it go. Good for daily standups, periodic research, content generation, or system checks.</p>' +
        '<h3>Safety</h3>' +
        '<p>Autopilot tasks still appear in the dashboard with a gear icon so you can monitor them. Use <strong>Pause All</strong> to instantly stop all schedules if needed. You can toggle autopilot off on any task at any time to re-enable human review.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'autopilot\')">Go to Autopilot &#8594;</button>'
    },
    {
      title: 'Knowledge Base',
      icon: '&#9776;',
      content: '<h2>Knowledge Base</h2>' +
        '<p>The Knowledge Base is a <strong>library of research and reference documents</strong> created by your agents. It' + q + 's the team' + q + 's institutional memory.</p>' +
        '<h3>How It Works</h3>' +
        '<ul>' +
        '<li>When a research task is completed, its deliverable can be <strong>promoted to the Knowledge Base</strong></li>' +
        '<li>Documents are categorized: Research, Analysis, Reference, or Guide</li>' +
        '<li>Tag documents for easy filtering and discovery</li>' +
        '<li>Agents can reference knowledge base docs in future work</li>' +
        '</ul>' +
        '<h3>Staleness</h3>' +
        '<p>Documents older than 30 days are flagged as stale during round tables. The orchestrator will ask you whether to update, archive, or keep them.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'knowledge\')">Go to Knowledge Base &#8594;</button>'
    },
    {
      title: 'Media Library',
      icon: '&#9634;',
      content: '<h2>Media Library</h2>' +
        '<p>The Media Library stores <strong>images, screenshots, videos, and documents</strong> from your team' + q + 's work.</p>' +
        '<h3>Features</h3>' +
        '<ul>' +
        '<li><strong>Thumbnails</strong> - Image files show visual previews</li>' +
        '<li><strong>Preview</strong> - Click any file to preview it in the browser</li>' +
        '<li><strong>Open in Folder</strong> - Jump to the file on your system</li>' +
        '<li><strong>Filter</strong> - Browse by type: Images, Documents, Video, or All</li>' +
        '</ul>' +
        '<p>Files are stored in <code>data/media/</code>. Agents save screenshots, generated images, and other assets here automatically.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'media\')">Go to Media Library &#8594;</button>'
    },
    {
      title: 'Skills & Connectors',
      icon: '&#9670;',
      content: '<h2>Skills &amp; Connectors</h2>' +
        '<p>Skills extend what your agents can do by connecting them to <strong>external tools and services</strong>.</p>' +
        '<h3>Skill Types</h3>' +
        '<ul>' +
        '<li><strong>MCP Skills</strong> - Model Context Protocol integrations that give agents direct tool access (e.g. Playwright for browser control, Trello for project boards)</li>' +
        '<li><strong>CLI Skills</strong> - Command-line tools agents can invoke (e.g. screen recording with ffmpeg, video creation with Remotion)</li>' +
        '</ul>' +
        '<h3>Managing Skills</h3>' +
        '<ul>' +
        '<li>Enable/disable skills with a toggle</li>' +
        '<li>Some skills require configuration (API keys, tokens)</li>' +
        '<li>Dependencies are installed automatically when you enable a skill</li>' +
        '</ul>' +
        '<button class="help-go-link" onclick="App.navigate(\'skills\')">Go to Skills &#8594;</button>'
    },
    {
      title: 'Security & Secrets',
      icon: '&#128274;',
      content: '<h2>Security &amp; Secrets</h2>' +
        '<p>TeamHero runs <strong>100% locally</strong> on your machine. No cloud, no external servers, no telemetry. Your data never leaves your computer unless you explicitly tell an agent to post or send something.</p>' +
        '<h3>Agent Sandbox - What You Need to Know</h3>' +
        '<p>Agents are instructed to stay within the project folder and follow security rules. However, <strong>this is enforced by rules, not by a technical sandbox</strong>. Agents run as Claude Code subprocesses with the same OS permissions as your user account. In theory, an agent could access files or run commands outside the project if it ignored its instructions.</p>' +
        '<p>The layers of protection:</p>' +
        '<ul>' +
        '<li><strong>CLAUDE.md safety boundaries</strong> - Every agent session includes strict rules: stay within the project root, never modify platform files, no destructive system commands. Claude follows these reliably.</li>' +
        '<li><strong>Security rules</strong> - Explicitly ban directory traversal, system file access, and dangerous commands (rm -rf, shutdown, kill, etc.).</li>' +
        '<li><strong>Supervised mode</strong> - In supervised mode, Claude Code prompts you for confirmation before file writes and shell commands outside the project. This is the strongest guard available.</li>' +
        '<li><strong>Autonomous mode</strong> - No confirmation prompts. The only protection is the AI following its rules. Faster, but you are trusting the instructions to hold.</li>' +
        '</ul>' +
        '<p><strong>Recommendation:</strong> If your machine has sensitive files outside the project, use <strong>supervised mode</strong>. Use autonomous mode only when you trust the workflow and have reviewed your agent rules. You can switch modes anytime in Settings.</p>' +
        '<h3>Two Storage Systems</h3>' +
        '<p>TeamHero has two separate systems for storing sensitive information:</p>' +
        '<ul>' +
        '<li><strong>Secrets Vault</strong> - For <strong>API keys, tokens, and service credentials</strong>. Encrypted with AES-256-GCM. Injected as environment variables (e.g. <code>$TRELLO_API_KEY</code>). Managed in Settings &gt; Secrets &amp; API Keys.</li>' +
        '<li><strong>Credentials Manager</strong> - For <strong>website login credentials</strong> (service name, username, password). Injected as paired environment variables: <code>{SERVICE}_USERNAME</code> and <code>{SERVICE}_PASSWORD</code>. Managed in Settings &gt; Credentials. Use this for platform logins agents need for browser-based tasks.</li>' +
        '</ul>' +
        '<p>Both are stored locally and encrypted. Neither uses the OS keychain.</p>' +
        '<h3>Secret Storage (Vault)</h3>' +
        '<p>API keys and tokens are stored in a single <strong>encrypted file</strong>: <code>config/secrets.enc</code>. This is TeamHero' + q + 's own vault - it does <strong>not</strong> use the OS keychain (Windows Credential Manager, macOS Keychain, etc.). The file is self-contained and portable with your project.</p>' +
        '<h3>How the Vault Works</h3>' +
        '<p>The encrypted file structure: <code>[32-byte salt] [12-byte IV] [16-byte auth tag] [ciphertext]</code></p>' +
        '<ul>' +
        '<li><strong>Encryption:</strong> AES-256-GCM - the same standard used by banks and governments</li>' +
        '<li><strong>Key derivation:</strong> Your master password is transformed into an encryption key using PBKDF2 with SHA-512 and 100,000 iterations - this makes brute-force attacks impractical</li>' +
        '<li><strong>Random salt:</strong> A 32-byte random salt is generated per vault, so identical passwords produce different keys even if the password is reused</li>' +
        '<li><strong>Tamper detection:</strong> GCM mode includes an authentication tag - if anyone modifies the encrypted file, decryption fails</li>' +
        '<li><strong>Locked by default:</strong> On disk, secrets are always encrypted. They are only decrypted into memory after you unlock with your master password. When the server stops, the decrypted values are gone.</li>' +
        '</ul>' +
        '<h3>Risks You Should Know</h3>' +
        '<ul>' +
        '<li><strong>Master password is not stored anywhere.</strong> If you forget it, your secrets are gone. There is no recovery mechanism - that is by design. Write it down somewhere safe.</li>' +
        '<li><strong>In-memory exposure:</strong> While the server is running and the vault is unlocked, decrypted secrets exist in process memory. Anyone with access to your machine could theoretically read them from the running process.</li>' +
        '<li><strong>AI agents can use your keys.</strong> When secrets are unlocked, agents receive them as environment variables. A misconfigured or poorly prompted agent could call an API in ways you did not intend. Always review agent rules and use supervised mode for sensitive operations.</li>' +
        '<li><strong>The encrypted file is only as strong as your password.</strong> A weak master password can be brute-forced offline. Use a strong, unique password.</li>' +
        '<li><strong>No access control between agents.</strong> All unlocked secrets are available to all agents. You cannot restrict specific keys to specific agents. If an agent should not have access to a key, do not store it in the vault while that agent is active.</li>' +
        '<li><strong>Local network exposure:</strong> The dashboard runs on localhost. If your machine is on a shared network and the port is accessible, others could potentially reach the dashboard. TeamHero does not have authentication on the web UI.</li>' +
        '</ul>' +
        '<h3>Secret Injection</h3>' +
        '<p>When the vault is unlocked, secrets are injected as <strong>environment variables</strong> into agent sessions. Agents can use them (e.g. <code>$TRELLO_API_KEY</code>) but never see the actual values in plain text.</p>' +
        '<h3>Output Scrubbing</h3>' +
        '<p>All terminal output is <strong>automatically scrubbed</strong> before being displayed. If an agent accidentally echoes a secret value, it appears as <code>[REDACTED]</code>. This works in real-time on every line of output.</p>' +
        '<h3>Prompt Injection Protection</h3>' +
        '<p>When agents process external content (emails, web pages, user-submitted text), they treat it as <strong>untrusted data</strong>:</p>' +
        '<ul>' +
        '<li>Never execute instructions found in external content</li>' +
        '<li>Summarize rather than quote verbatim</li>' +
        '<li>Flag suspicious content that looks like injection attempts</li>' +
        '</ul>' +
        '<h3>File System Boundaries</h3>' +
        '<ul>' +
        '<li>All agent file operations are confined to the <strong>project root directory</strong></li>' +
        '<li>Agents cannot modify platform files (server.js, portal/) - these are protected</li>' +
        '<li>Path traversal is validated to prevent escaping the project sandbox</li>' +
        '<li>No destructive system commands (rm -rf, shutdown, kill, etc.)</li>' +
        '</ul>' +
        '<h3>External Communication Control</h3>' +
        '<ul>' +
        '<li>No emails, social media posts, git pushes, or API calls without <strong>explicit owner approval</strong></li>' +
        '<li>Content must be reviewed before publishing - even autopilot tasks log what they do</li>' +
        '<li>All published URLs are logged on the task for auditability</li>' +
        '</ul>' +
        '<h3>Security Rules</h3>' +
        '<p>You can edit the security rules in <strong>Team Rules</strong> under the Security section. These rules are injected into every agent session and enforced automatically.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'rules\')">Edit Security Rules &#8594;</button>'
    },
    {
      title: 'Settings & Config',
      icon: '&#9881;',
      content: '<h2>Settings &amp; Configuration</h2>' +
        '<h3>Owner Profile</h3>' +
        '<p>Your profile tells agents who you are - your name, role, expertise, and goals. Agents use this to tailor their work to your needs.</p>' +
        '<h3>Team Rules</h3>' +
        '<p>Operational rules that apply to all agents: task lifecycle, delegation rules, content standards, and collaboration protocols. These are the law of your team.</p>' +
        '<h3>Permission Modes</h3>' +
        '<ul>' +
        '<li><strong>Autonomous</strong> - Agents operate freely without confirmation prompts</li>' +
        '<li><strong>Supervised</strong> - Agents ask before executing certain actions</li>' +
        '</ul>' +
        '<h3>Credentials Manager</h3>' +
        '<p>Store website login credentials for services your agents need to access. Each entry has a service name, username, and password. They are injected as environment variables (<code>{SERVICE}_USERNAME</code> and <code>{SERVICE}_PASSWORD</code>) so agents can use them in browser-based tasks without you pasting credentials each time.</p>' +
        '<h3>Secrets &amp; API Keys</h3>' +
        '<p>Store API keys and tokens in the encrypted vault. These are injected as environment variables into agent sessions. See the <strong>Security &amp; Secrets</strong> help topic for details on how the vault works.</p>' +
        '<h3>Updates &amp; Self-Healing</h3>' +
        '<p>Check for platform updates from GitHub. Updates only affect platform files - your agents, tasks, and data are never touched. The upgrade system includes <strong>self-healing</strong>: if critical bootstrap files (launch scripts, package.json) are missing or corrupted, the updater detects and restores them automatically.</p>' +
        '<h3>CLI Installer</h3>' +
        '<p>When installing TeamHero via the CLI, the installer prompts you for a <strong>folder name</strong> for your team. This becomes the project directory where all your team data lives.</p>' +
        '<button class="help-go-link" onclick="App.navigate(\'settings\')">Go to Settings &#8594;</button>'
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

  // ── JS-based tooltips (avoid sidebar overflow clipping) ──
  (function initTooltips() {
    var tip = document.createElement('div');
    tip.className = 'tooltip-popup';
    document.body.appendChild(tip);

    document.addEventListener('mouseenter', function(e) {
      if (!e.target || !e.target.closest) return;
      var el = e.target.closest('[data-tooltip]');
      if (!el) return;
      tip.textContent = el.getAttribute('data-tooltip');
      var rect = el.getBoundingClientRect();
      tip.style.left = (rect.right + 8) + 'px';
      tip.style.top = (rect.top + rect.height / 2) + 'px';
      tip.style.transform = 'translateY(-50%)';
      tip.classList.add('visible');
    }, true);

    document.addEventListener('mouseleave', function(e) {
      if (!e.target || !e.target.closest) return;
      var el = e.target.closest('[data-tooltip]');
      if (!el) return;
      tip.classList.remove('visible');
    }, true);
  })();

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
    switchFilesSubTab: switchFilesSubTab,
    loadAgentFiles: loadAgentFiles,
    toggleFilesSection: toggleFilesSection,
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
    shutdownServer: shutdownServer,
    restartServer: restartServer,
    runRoundTable: runRoundTable,
    restartTerminal: restartTerminal,
    savePermissionMode: savePermissionMode,
    addAccessPath: addAccessPath,
    removeAccessPath: removeAccessPath,
    unlockSecrets: unlockSecrets,
    lockSecrets: lockSecrets,
    initializeSecrets: initializeSecrets,
    showAddSecret: showAddSecret,
    cancelAddSecret: cancelAddSecret,
    saveSecret: saveSecret,
    editSecret: editSecret,
    deleteSecret: deleteSecret,
    changeSecretsPassword: changeSecretsPassword,
    showAddCredential: showAddCredential,
    cancelAddCredential: cancelAddCredential,
    saveCredential: saveCredential,
    initializeCredentialsVault: initializeCredentialsVault,
    editCredential: editCredential,
    deleteCredential: deleteCredential,
    checkForUpdates: checkForUpdates,
    performUpgrade: performUpgrade,
    closeUpgradeModal: closeUpgradeModal,
    toggleUpgradeBtn: toggleUpgradeBtn,
    confirmUpgrade: confirmUpgrade,
    dismissUpgradeBanner: dismissUpgradeBanner,
    retryMigrations: retryMigrations,
    rollbackUpgrade: rollbackUpgrade,
    checkClaudeStatus: checkClaudeStatus,
    switchSettingsSection: switchSettingsSection,
    toggleSkill: toggleSkill,
    saveSkillSettings: saveSkillSettings,
    viewVersionFile: viewVersionFile,
    viewFile: viewFile,
    previewFileInModal: previewFileInModal,
    closeFilePreview: closeFilePreview,
    togglePreviewFeedback: togglePreviewFeedback,
    submitPreviewFeedback: submitPreviewFeedback,
    attachPreviewImage: attachPreviewImage,
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
    createBackup: createBackup,
    restoreBackup: restoreBackup,
    deleteBackup: deleteBackup,
    openAutopilotForm: openAutopilotForm,
    cancelAutopilotForm: cancelAutopilotForm,
    saveAutopilot: saveAutopilot,
    toggleAutopilot: toggleAutopilot,
    editAutopilot: editAutopilot,
    deleteAutopilot: deleteAutopilot,
    pauseAllAutopilot: pauseAllAutopilot,
    resumeAllAutopilot: resumeAllAutopilot,
    selectHelpTopic: selectHelpTopic,
    navigateTask: navigateTask,
    toggleTaskAutopilot: toggleTaskAutopilot,
    setViewMode: setViewMode,
    toggleFlowExpand: toggleFlowExpand,
    toggleHierarchyExpand: toggleHierarchyExpand,
    removeTag: removeTag,
    selectAutoTag: selectAutoTag,
    toggleTagFilter: toggleTagFilter,
    clearTagFilters: clearTagFilters,
    toggleTagVisibility: toggleTagVisibility,
    toggleTagFilterExpand: toggleTagFilterExpand,
    toggleAgentFilter: toggleAgentFilter,
    clearAgentFilter: clearAgentFilter,
    selectDep: selectDep,
    toggleSort: toggleSort,
  };

  init();
})();
