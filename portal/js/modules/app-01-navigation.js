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
      if (viewId === 'terms') loadTerms();
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

