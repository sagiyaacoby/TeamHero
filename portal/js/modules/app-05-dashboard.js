  // ── Dashboard ──────────────────────────────────────
  async function loadDashboard() {
    try {
      const [agentsData, tasksData, archiveData] = await Promise.all([
        api.get('/api/agents'),
        api.get('/api/tasks'),
        api.get('/api/tasks?include=archive'),
      ]);
      state.agents = agentsData.agents || [];
      state.tasks = tasksData.tasks || [];
      renderSidebarAgents();

      document.getElementById('stat-agents').textContent = state.agents.length;
      var pendingCount = 0, workingCount = 0, doneCount = 0, holdCount = 0, cancelledCount = 0, closedCount = 0;
      // Use merged (active + archive) data for closed/cancelled counts
      var allTasks = (archiveData && archiveData.tasks) || state.tasks;
      allTasks.forEach(function(t) {
        // Pending counts ALL tasks (including subtasks) - owner must see everything needing review
        if (t.status === 'planning' || t.status === 'pending_approval') { pendingCount++; return; }
        // Other stats count top-level only
        if (t.parentTaskId) return;
        if (t.status === 'working') workingCount++;
        else if (t.status === 'done') doneCount++;
        else if (t.status === 'hold') holdCount++;
        else if (t.status === 'cancelled') cancelledCount++;
        else if (t.status === 'closed') closedCount++;
      });
      document.getElementById('stat-pending').textContent = pendingCount;
      document.getElementById('stat-working').textContent = workingCount;
      document.getElementById('stat-done').textContent = doneCount;
      document.getElementById('stat-hold').textContent = holdCount;
      document.getElementById('stat-cancelled').textContent = cancelledCount;
      document.getElementById('stat-closed').textContent = closedCount;
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
      renderTeamPerformance();
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

      // Model routing integration
      var modelBar = document.getElementById('agent-model-bar');
      if (modelBar) {
        if (agent.isOrchestrator) {
          modelBar.style.display = 'none';
        } else {
          modelBar.style.display = 'flex';
          try {
            var routingConfig = state.modelRouting || await api.get('/api/settings/model-routing');
            state.modelRouting = routingConfig;
            var select = document.getElementById('agent-model-select');
            var currentModel = (routingConfig.agentModels || {})[id] || '';
            if (select) select.value = currentModel;
            updateAgentModelInfo(routingConfig);
          } catch(re) { console.error('Model routing load error:', re); }
        }
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

    var pendingA = 0, workingA = 0, doneA = 0, holdA = 0, cancelledA = 0, closedA = 0;
    tasks.forEach(function(t) {
      if (t.status === 'planning' || t.status === 'pending_approval') pendingA++;
      else if (t.status === 'working') workingA++;
      else if (t.status === 'done') doneA++;
      else if (t.status === 'hold') holdA++;
      else if (t.status === 'cancelled') cancelledA++;
      else if (t.status === 'closed') closedA++;
    });
    // Auto-select first non-empty filter so user always sees tasks
    var filterCounts = [
      { key: 'pending', count: pendingA },
      { key: 'working', count: workingA },
      { key: 'done', count: doneA },
      { key: 'hold', count: holdA },
      { key: 'cancelled', count: cancelledA },
      { key: 'closed', count: closedA }
    ];
    var currentFilterCount = filterCounts.filter(function(f) { return f.key === state.agentTaskFilter; });
    if (currentFilterCount.length === 0 || currentFilterCount[0].count === 0) {
      var firstNonEmpty = filterCounts.filter(function(f) { return f.count > 0; })[0];
      if (firstNonEmpty) state.agentTaskFilter = firstNonEmpty.key;
    }
    var af = state.agentTaskFilter;
    summaryEl.innerHTML =
      '<span class="badge badge-pending_approval clickable-badge' + (af === 'pending' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'pending\',\'agent\')">' + pendingA + ' Pending</span> ' +
      '<span class="badge badge-working clickable-badge' + (af === 'working' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'working\',\'agent\')">' + workingA + ' Working</span> ' +
      '<span class="badge badge-done clickable-badge' + (af === 'done' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'done\',\'agent\')">' + doneA + ' Done</span> ' +
      '<span class="badge badge-hold clickable-badge' + (af === 'hold' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'hold\',\'agent\')">' + holdA + ' Hold</span> ' +
      '<span class="badge badge-cancelled clickable-badge' + (af === 'cancelled' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'cancelled\',\'agent\')">' + cancelledA + ' Cancelled</span> ' +
      '<span class="badge badge-closed clickable-badge' + (af === 'closed' ? ' badge-active-filter' : '') + '" onclick="App.filterTasks(\'closed\',\'agent\')">' + closedA + ' Closed</span>';

    state.cachedAgentTasks = tasks;
    updateSortButtons('agent');
    renderFilteredTasks('agent');
  }

  function getFilteredRootTasks(context) {
    var filter = context === 'dashboard' ? state.dashboardTaskFilter : state.agentTaskFilter;
    var tasks = context === 'dashboard' ? state.cachedDashboardTasks : state.cachedAgentTasks;

    var filtered;
    if (filter === 'pending') {
      // Pending shows ALL tasks needing attention - including subtasks
      filtered = tasks.filter(function(t) { return t.status === 'planning' || t.status === 'pending_approval'; });
    } else if (filter === 'working') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && t.status === 'working'; });
    } else if (filter === 'done') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && t.status === 'done'; });
    } else if (filter === 'hold') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && t.status === 'hold'; });
    } else if (filter === 'cancelled') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && t.status === 'cancelled'; });
    } else if (filter === 'closed') {
      filtered = tasks.filter(function(t) { return !t.parentTaskId && t.status === 'closed'; });
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
      return !dep || (dep.status !== 'closed' && dep.status !== 'done');
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

