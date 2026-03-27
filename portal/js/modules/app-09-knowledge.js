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


