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

  // Check if user is actively interacting with the task detail view
  function isTaskDetailUserActive() {
    if (state.currentView !== 'task-detail') return false;
    // Check if any input/textarea in the task detail view has focus
    var active = document.activeElement;
    if (active) {
      var tag = (active.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select' || active.isContentEditable) {
        var taskView = document.getElementById('view-task-detail');
        if (taskView && taskView.contains(active)) return true;
      }
    }
    // Check if feedback area is visible and has content
    var feedbackArea = document.getElementById('task-feedback-area');
    if (feedbackArea && !feedbackArea.classList.contains('hidden')) {
      var textarea = document.getElementById('task-review-comments');
      if (textarea && textarea.value.trim().length > 0) return true;
    }
    // Check if any file preview feedback textarea has content
    var previewTextareas = document.querySelectorAll('.file-preview-feedback-textarea');
    for (var i = 0; i < previewTextareas.length; i++) {
      if (previewTextareas[i].value && previewTextareas[i].value.trim().length > 0) return true;
    }
    return false;
  }

  // Lightweight update for task detail - updates status/priority badges without full re-render
  async function softRefreshTaskDetail(taskId) {
    try {
      var task = await api.get('/api/tasks/' + taskId);
      // Update status badge
      var statusEl = document.getElementById('task-detail-status');
      if (statusEl) {
        var displayStatus = task.status || 'planning';
        var statusLabel = STATUS_LABELS[displayStatus] || displayStatus.replace(/_/g, ' ');
        if (displayStatus === 'working') {
          statusEl.innerHTML = escHtml(statusLabel) + ' <span class="agent-working-dot"></span>';
        } else {
          statusEl.textContent = statusLabel;
        }
        statusEl.className = 'badge badge-' + displayStatus;
      }
      // Update priority badge
      var priorityEl = document.getElementById('task-detail-priority');
      if (priorityEl) {
        priorityEl.textContent = task.priority || 'medium';
        priorityEl.className = 'badge badge-' + (task.priority || 'medium');
      }
      // Update title
      var titleEl = document.getElementById('task-detail-title');
      if (titleEl) titleEl.textContent = task.title || 'Untitled';
      // Update blocker banner - add or remove based on current blocker state
      var sessionEl = document.getElementById('task-session');
      if (sessionEl) {
        var existingBanner = sessionEl.querySelector('.blocker-banner');
        if (task.blocker && !existingBanner) {
          // Blocker was set - insert banner at the top of the session container
          var bannerHtml = '<div class="blocker-banner">' +
            '<span class="blocker-banner-icon">&#9888;</span>' +
            '<span class="blocker-banner-text"><strong>BLOCKER:</strong> ' + linkifyText(escHtml(task.blocker)) + '</span>' +
            '</div>';
          sessionEl.insertAdjacentHTML('afterbegin', bannerHtml);
        } else if (!task.blocker && existingBanner) {
          // Blocker was cleared - remove the banner
          existingBanner.remove();
        } else if (task.blocker && existingBanner) {
          // Blocker text changed - update it
          var textEl = existingBanner.querySelector('.blocker-banner-text');
          if (textEl) textEl.innerHTML = '<strong>BLOCKER:</strong> ' + linkifyText(escHtml(task.blocker));
        }
      }
      // Keep currentTask in sync for consistent subsequent renders
      if (state.currentTask && state.currentTask.id === taskId) {
        state.currentTask.blocker = task.blocker;
        state.currentTask.status = task.status;
        state.currentTask.priority = task.priority;
        state.currentTask.title = task.title;
      }
    } catch(e) {
      // Soft refresh failed - not critical, full refresh will happen when user finishes editing
    }
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
      if (v === 'task-detail' && state.currentTaskId) {
        // Skip full re-render if user is actively typing/editing - preserve their input
        if (isTaskDetailUserActive()) {
          softRefreshTaskDetail(state.currentTaskId);
        } else {
          openTask(state.currentTaskId);
        }
      }
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
    if (scope === 'all' || scope === 'config') {
      loadGlobalAutopilot();
      if (v === 'settings') renderModelRoutingSettings();
      // Refresh model routing state for sidebar badges
      loadModelRoutingState();
    }
    if (scope === 'all' || scope === 'media') {
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
      // Load model routing config for sidebar badges
      if (!state.modelRouting) {
        try { state.modelRouting = await api.get('/api/settings/model-routing'); } catch(e2) { state.modelRouting = { mode: 'default' }; }
      }
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

    // Build agent dot state: 'blocked' (red pulse), 'pending' (yellow pulse), 'active' (green pulse), or undefined (no dot)
    var agentDotState = {};
    var workingStatuses = { planning: true, working: true, in_progress: true };
    // Group tasks by agent (only working/planning/pending_approval + blocker tasks)
    var agentTaskMap = {};
    (state.tasks || []).forEach(function(t) {
      if (!t.assignedTo) return;
      if (!workingStatuses[t.status] && t.status !== 'pending_approval' && !(t.blocker && t.status !== 'done' && t.status !== 'closed' && t.status !== 'cancelled')) return;
      if (!agentTaskMap[t.assignedTo]) agentTaskMap[t.assignedTo] = [];
      agentTaskMap[t.assignedTo].push(t);
    });
    // Determine dot state per agent: blocked > interrupted > pending > active > no dot
    Object.keys(agentTaskMap).forEach(function(agentId) {
      var tasks = agentTaskMap[agentId];
      var anyBlocked = tasks.some(function(t) { return !!t.blocker && t.status !== 'cancelled' && t.status !== 'closed' && t.status !== 'done'; });
      var anyInterrupted = tasks.some(function(t) { return !!t.interrupted && (t.status === 'working' || t.status === 'planning'); });
      var anyPending = tasks.some(function(t) { return t.status === 'pending_approval'; });
      var anyActive = tasks.some(function(t) { return !!workingStatuses[t.status]; });
      if (anyBlocked) agentDotState[agentId] = 'blocked';
      else if (anyInterrupted) agentDotState[agentId] = 'interrupted';
      else if (anyPending) agentDotState[agentId] = 'pending';
      else if (anyActive) agentDotState[agentId] = 'active';
    });
    // Also include agents with active activity state from API
    state.agents.forEach(function(a) {
      if (a.active && !agentDotState[a.id]) agentDotState[a.id] = 'active';
    });

    var html = '';

    orchAgents.forEach(function(a) {
      var isActive = state.currentView === 'agent-detail' && state.currentAgentId === a.id;
      var ds = agentDotState[a.id];
      var dotClass = ds === 'blocked' ? 'agent-dot agent-dot-blocked' : ds === 'interrupted' ? 'agent-dot agent-dot-interrupted' : ds === 'pending' ? 'agent-dot agent-dot-pending' : ds === 'active' ? 'agent-dot agent-dot-working' : 'agent-dot agent-dot-idle';
      var dotTitle = ds === 'blocked' ? 'Has blocked task' : ds === 'interrupted' ? 'Agent disconnected' : ds === 'pending' ? 'Awaiting approval' : ds === 'active' ? 'Working on task' : '';
      var nameHtml = escHtml(a.name);
      if (a.role || a.mission) {
        nameHtml = '<span data-tooltip="' + escHtml((a.role || '') + (a.role && a.mission ? '\n' : '') + (a.mission || '')) + '">' + escHtml(a.name) + '</span>';
      }
      var orchBadge = '';
      if (state.modelRouting && state.modelRouting.mode !== 'default') {
        var orchModel = (state.modelRouting.orchestratorModel) || ((state.modelRouting.agentModels || {})[a.id]);
        if (orchModel && MODEL_DISPLAY[orchModel]) {
          orchBadge = '<span class="model-badge model-badge-' + orchModel + '" title="' + MODEL_DISPLAY[orchModel] + '">[' + orchModel[0].toUpperCase() + ']</span>';
        }
      }
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link nav-orchestrator' + (isActive ? ' active' : '') + '">' +
        '<span class="icon">&#9733;</span> ' + nameHtml + orchBadge + '<span class="' + dotClass + '" title="' + dotTitle + '"></span></a>';
    });

    subAgents.forEach(function(a) {
      var isActive = state.currentView === 'agent-detail' && state.currentAgentId === a.id;
      var ds = agentDotState[a.id];
      var dotClass = ds === 'blocked' ? 'agent-dot agent-dot-blocked' : ds === 'interrupted' ? 'agent-dot agent-dot-interrupted' : ds === 'pending' ? 'agent-dot agent-dot-pending' : ds === 'active' ? 'agent-dot agent-dot-working' : 'agent-dot agent-dot-idle';
      var dotTitle = ds === 'blocked' ? 'Has blocked task' : ds === 'interrupted' ? 'Agent disconnected' : ds === 'pending' ? 'Awaiting approval' : ds === 'active' ? 'Working on task' : '';
      var nameHtml = escHtml(a.name);
      if (a.role || a.mission) {
        nameHtml = '<span data-tooltip="' + escHtml((a.role || '') + (a.role && a.mission ? '\n' : '') + (a.mission || '')) + '">' + escHtml(a.name) + '</span>';
      }
      var isExpanded = state.expandedAgents && state.expandedAgents[a.id];
      html += '<div class="nav-agent-group">';
      html += '<div class="nav-agent-row">';
      html += '<span class="nav-agent-arrow' + (isExpanded ? ' expanded' : '') + '" data-agent-id="' + a.id + '" title="Show files">&#9654;</span>';
      var agentBadge = '';
      if (state.modelRouting && state.modelRouting.mode !== 'default') {
        var agentModel = (state.modelRouting.agentModels || {})[a.id];
        if (agentModel && MODEL_DISPLAY[agentModel]) {
          agentBadge = '<span class="model-badge model-badge-' + agentModel + '" title="' + MODEL_DISPLAY[agentModel] + '">[' + agentModel[0].toUpperCase() + ']</span>';
        }
      }
      html += '<a href="#" data-agent-id="' + a.id + '" class="nav-link' + (isActive ? ' active' : '') + '" style="flex:1">' +
        nameHtml + agentBadge + '<span class="' + dotClass + '" title="' + dotTitle + '"></span></a>';
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

    // Update pending and working count badges
    var pendingCount = 0;
    var workingCount = 0;
    (state.tasks || []).forEach(function(t) {
      if (t.status === 'pending_approval') pendingCount++;
      if (t.status === 'working' || t.status === 'planning') workingCount++;
    });

    // Dashboard nav badge (pending)
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

    // Header status bubbles
    var pendingBubble = document.getElementById('header-pending-bubble');
    var workingBubble = document.getElementById('header-working-bubble');
    if (pendingBubble) {
      if (pendingCount > 0) {
        pendingBubble.textContent = pendingCount;
        pendingBubble.style.display = 'flex';
      } else {
        pendingBubble.style.display = 'none';
      }
    }
    if (workingBubble) {
      if (workingCount > 0) {
        workingBubble.textContent = workingCount;
        workingBubble.style.display = 'flex';
      } else {
        workingBubble.style.display = 'none';
      }
    }

    updateAutopilotBadge();
  }

