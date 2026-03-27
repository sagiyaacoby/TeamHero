  // ── Agent Stats Tab ─────────────────────────────
  var statsCache = null;

  async function loadStats() {
    if (statsCache && Date.now() - statsCache._ts < 30000) return statsCache;
    try {
      var data = await api.get('/api/stats');
      data._ts = Date.now();
      statsCache = data;
      return data;
    } catch(e) {
      console.error('Failed to load stats:', e);
      return null;
    }
  }

  function formatHours(h) {
    if (h < 1) return '<1h';
    if (h < 24) return Math.round(h) + 'h';
    var d = h / 24;
    return d < 2 ? '1 day' : Math.round(d * 10) / 10 + ' days';
  }

  async function loadAgentStats(agentId) {
    var el = document.getElementById('agent-stats-content');
    if (!el) return;
    el.innerHTML = '<p class="empty-state">Loading stats...</p>';
    var data = await loadStats();
    if (!data) { el.innerHTML = '<p class="empty-state">Failed to load stats</p>'; return; }
    var ag = null;
    (data.agents || []).forEach(function(a) { if (a.id === agentId) ag = a; });
    if (!ag) { el.innerHTML = '<p class="empty-state">No stats available for this agent</p>'; return; }

    var revPct = Math.round(ag.revisionRate * 100);
    var revColor = revPct <= 10 ? 'var(--green)' : revPct <= 25 ? 'var(--yellow)' : 'var(--red)';

    var html = '<div class="perf-stats-row">';
    html += '<div class="perf-stat-card"><div class="perf-stat-value">' + ag.closedTasks + '</div><div class="perf-stat-label">Closed</div></div>';
    html += '<div class="perf-stat-card"><div class="perf-stat-value">' + ag.activeTasks + '</div><div class="perf-stat-label">Active</div></div>';
    html += '<div class="perf-stat-card"><div class="perf-stat-value">' + formatHours(ag.avgCloseTimeHours) + '</div><div class="perf-stat-label">Avg Close Time</div></div>';
    html += '<div class="perf-stat-card"><div class="perf-stat-value" style="color:' + revColor + '">' + revPct + '%</div><div class="perf-stat-label">Revision Rate</div></div>';
    html += '</div>';

    // Activity - last 7d / 30d
    html += '<div class="panel" style="margin-top:16px"><h3>Activity</h3>';
    html += '<div class="perf-activity-row">';
    html += '<div class="perf-activity-block"><div class="perf-activity-label">Last 7 days</div><div class="perf-activity-nums"><span class="perf-num-green">' + ag.last7Days.closed + ' closed</span> <span class="perf-num-muted">' + ag.last7Days.created + ' created</span></div></div>';
    html += '<div class="perf-activity-block"><div class="perf-activity-label">Last 30 days</div><div class="perf-activity-nums"><span class="perf-num-green">' + ag.last30Days.closed + ' closed</span> <span class="perf-num-muted">' + ag.last30Days.created + ' created</span></div></div>';
    html += '</div></div>';

    // Task type breakdown
    var types = ag.tasksByType || {};
    var typeKeys = Object.keys(types);
    if (typeKeys.length > 0) {
      var maxType = Math.max.apply(null, typeKeys.map(function(k) { return types[k]; }));
      html += '<div class="panel" style="margin-top:16px"><h3>Task Types</h3>';
      typeKeys.sort(function(a,b) { return types[b] - types[a]; });
      typeKeys.forEach(function(k) {
        var pct = maxType > 0 ? Math.round(types[k] / maxType * 100) : 0;
        html += '<div class="perf-type-row"><span class="perf-type-name">' + escHtml(k) + '</span><div class="perf-type-bar-bg"><div class="perf-type-bar" style="width:' + pct + '%"></div></div><span class="perf-type-count">' + types[k] + '</span></div>';
      });
      html += '</div>';
    }

    // Blockers
    if (ag.blockerCount > 0) {
      html += '<div class="panel" style="margin-top:16px"><h3>Blockers</h3><p style="color:var(--red)">' + ag.blockerCount + ' task(s) currently blocked</p></div>';
    }

    el.innerHTML = html;
  }

  async function renderTeamPerformance() {
    var section = document.getElementById('team-performance-section');
    if (!section) return;
    var data = await loadStats();
    if (!data || !data.agents || data.agents.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';
    var cardsEl = document.getElementById('team-perf-cards');
    var html = '';
    data.agents.forEach(function(ag) {
      if (ag.totalTasks === 0) return;
      var revPct = Math.round(ag.revisionRate * 100);
      var revColor = revPct <= 10 ? 'var(--green)' : revPct <= 25 ? 'var(--yellow)' : 'var(--red)';
      html += '<div class="team-perf-card" onclick="App.navigate(\'agent-detail\',\'' + ag.id + '\'); setTimeout(function(){App.switchAgentTab(\'stats\');},100);">';
      html += '<div class="team-perf-card-name">' + escHtml(ag.name) + '</div>';
      html += '<div class="team-perf-card-role">' + escHtml(ag.role) + '</div>';
      html += '<div class="team-perf-card-stats">';
      html += '<div><span class="team-perf-num">' + ag.closedTasks + '</span> closed</div>';
      html += '<div><span class="team-perf-num">' + ag.activeTasks + '</span> active</div>';
      html += '<div>Avg: <span class="team-perf-num">' + formatHours(ag.avgCloseTimeHours) + '</span></div>';
      html += '<div>Rev: <span class="team-perf-num" style="color:' + revColor + '">' + revPct + '%</span></div>';
      html += '</div></div>';
    });
    cardsEl.innerHTML = html;
  }

  var teamPerfExpanded = false;
  function toggleTeamPerf() {
    teamPerfExpanded = !teamPerfExpanded;
    var cardsEl = document.getElementById('team-perf-cards');
    var icon = document.getElementById('team-perf-toggle-icon');
    if (teamPerfExpanded) {
      cardsEl.style.display = '';
      icon.innerHTML = '&#9660;';
    } else {
      cardsEl.style.display = 'none';
      icon.innerHTML = '&#9654;';
    }
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

