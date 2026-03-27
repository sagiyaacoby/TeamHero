  // ── Task Detail ─────────────────────────────────
  async function openTask(id) {
    state.currentTaskId = id;
    state.previousView = state.currentView;
    state.previousAgentId = state.currentAgentId;

    try {
      var task = await api.get('/api/tasks/' + id);
      state.currentTask = task;

      document.getElementById('task-detail-title').textContent = task.title || 'Untitled';

      var statusEl = document.getElementById('task-detail-status');
      var displayStatus = task.status || 'planning';
      var statusLabel = STATUS_LABELS[displayStatus] || displayStatus.replace(/_/g, ' ');
      if (displayStatus === 'working') {
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

      // Model info for task detail
      var modelInfoEl = document.getElementById('task-detail-model-info');
      if (modelInfoEl) {
        var mr = state.modelRouting || { mode: 'default' };
        if (mr.mode !== 'default' && task.assignedTo) {
          var agentModel = (mr.agentModels || {})[task.assignedTo];
          if (agentModel && MODEL_DISPLAY[agentModel]) {
            modelInfoEl.innerHTML = '<span class="task-model-label">Model:</span> <span class="model-badge model-badge-' + agentModel + '">[' + agentModel[0].toUpperCase() + ']</span> ' + MODEL_DISPLAY[agentModel];
            modelInfoEl.style.display = '';
          } else {
            modelInfoEl.style.display = 'none';
          }
        } else {
          modelInfoEl.style.display = 'none';
        }
      }

      var dateHtml = '';
      if (task.createdAt) dateHtml += 'Created: ' + new Date(task.createdAt).toLocaleString() + ' (' + timeAgo(task.createdAt) + ')';
      if (task.updatedAt && task.updatedAt !== task.createdAt) dateHtml += ' | Updated: ' + new Date(task.updatedAt).toLocaleString() + ' (' + timeAgo(task.updatedAt) + ')';
      if (task.dueDate) {
        var dueDate = new Date(task.dueDate);
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var isOverdue = dueDate < today && task.status !== 'closed' && task.status !== 'done';
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
        var kbLinkHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> <a onclick="App.openKnowledgeDoc(\'' + task.knowledgeDocId + '\')">View in Knowledge Base</a>';
        if (task.promotedToKb) {
          kbLinkHtml += ' <span class="auto-promoted-badge">Auto-promoted to KB</span>';
        }
        if (task.promotedToMedia) {
          kbLinkHtml += ' <span class="auto-promoted-badge auto-promoted-media">Auto-promoted to Media</span>';
        }
        knowledgeLink.innerHTML = kbLinkHtml;
        knowledgeLink.classList.remove('hidden');
      } else if (task.status === 'closed' || task.status === 'done') {
        promoteBar.classList.remove('hidden');
        var extraBadges = '';
        if (task.promotedToMedia) {
          extraBadges = '<span class="auto-promoted-badge auto-promoted-media" style="margin-left:8px">Auto-promoted to Media</span>';
        }
        knowledgeLink.innerHTML = extraBadges;
        knowledgeLink.classList.toggle('hidden', !extraBadges);
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

    if (versions.length === 0 && task.status === 'working') {
      html += '<div class="session-planning-banner"><span class="agent-working-dot"></span> Agent is working on a plan. Progress updates will appear below.</div>';
    } else if (versions.length === 0 && task.status === 'planning' && (!task.progressLog || task.progressLog.length === 0)) {
      html += '<div class="session-awaiting">Awaiting agent submission...</div>';
    }

    // ── Build unified timeline ──
    // Collect all events: versions, progress entries, owner feedback
    var timeline = [];

    // Add version events (chronological: v1 first, v2 after, etc.)
    versions.forEach(function(v, idx) {
      var ts = v.submittedAt || v.decidedAt || task.createdAt || '';
      timeline.push({ type: 'version', data: v, idx: idx, timestamp: ts, _versionNum: v.number || (idx + 1) });
      // Add deliverable/result/files as separate event after progress logs for this round
      if (v.deliverable || v.result || (v.files && v.files.length > 0)) {
        var delTs = v.submittedAt || v.decidedAt || task.createdAt || '';
        timeline.push({ type: 'version_deliverable', data: v, idx: idx, timestamp: delTs, _versionNum: v.number || (idx + 1) });
      }
      // Add owner feedback as separate event after version deliverables
      if (v.decision || v.comments) {
        var fbTs = v.decidedAt || v.submittedAt || ts;
        timeline.push({ type: 'feedback', data: v, timestamp: fbTs, _after: true, _versionNum: v.number || (idx + 1) });
      }
    });

    // Add progress log entries
    if (task.progressLog && task.progressLog.length > 0) {
      task.progressLog.forEach(function(entry) {
        timeline.push({ type: 'progress', data: entry, timestamp: entry.timestamp || '' });
      });
    }

    // Add agent history entries (assignment/stage changes)
    if (task.agentHistory && task.agentHistory.length > 0) {
      task.agentHistory.forEach(function(entry) {
        timeline.push({ type: 'agent_change', data: entry, timestamp: entry.at || '' });
      });
    }

    // Sort chronologically with version-aware ordering
    // Approach: assign each event to a "round" based on which version it belongs to.
    // Progress/agent_change events are assigned to the version round they fall within.
    // Within each round: version -> progress/agent_change (by timestamp) -> deliverable -> feedback

    // First, determine version time boundaries for round assignment
    // Round N+1 starts when the owner decides on version N (decidedAt), since that's when
    // new work toward the next version begins. Events after v1.decidedAt belong to round 2.
    var versionBoundaries = [];
    var sortedVersions = versions.slice().sort(function(a, b) { return a.number - b.number; });
    sortedVersions.forEach(function(v, vi) {
      var roundStart;
      if (vi === 0) {
        // Round 1 starts at the beginning of time
        roundStart = 0;
      } else {
        // Round N starts when the previous version was decided (owner reviewed it)
        var prev = sortedVersions[vi - 1];
        roundStart = new Date(prev.decidedAt || prev.submittedAt || task.createdAt || 0).getTime();
      }
      versionBoundaries.push({ num: v.number, ts: roundStart });
    });

    // Assign round numbers to non-version events (progress, agent_change)
    timeline.forEach(function(evt) {
      if (evt._versionNum) return; // already has a version/round assignment
      var evtTime = new Date(evt.timestamp || 0).getTime();
      // Find which version round this event belongs to (the latest round that started before/at this event)
      var round = 0;
      for (var vi = 0; vi < versionBoundaries.length; vi++) {
        if (evtTime >= versionBoundaries[vi].ts) {
          round = versionBoundaries[vi].num;
        }
      }
      // If no round matched, assign to first version round
      if (round === 0 && versionBoundaries.length > 0) round = versionBoundaries[0].num;
      evt._roundNum = round;
    });

    timeline.sort(function(a, b) {
      // Determine round for each event
      var aRound = a._versionNum || a._roundNum || 0;
      var bRound = b._versionNum || b._roundNum || 0;
      // Different rounds: sort by round number (ensures v1 before v2)
      if (aRound !== bRound) return aRound - bRound;
      // Same round: sort by type priority, then timestamp
      // version (0) -> agent_change (1) -> progress (2) -> version_deliverable (3) -> feedback (4)
      var order = { version: 0, agent_change: 1, progress: 2, version_deliverable: 3, feedback: 4 };
      var aOrder = order[a.type] !== undefined ? order[a.type] : 2;
      var bOrder = order[b.type] !== undefined ? order[b.type] : 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Same type within same round: sort by timestamp
      var ta = new Date(a.timestamp || 0).getTime();
      var tb = new Date(b.timestamp || 0).getTime();
      return ta - tb;
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
          if (v.submittedAt) html += ' - ' + new Date(v.submittedAt).toLocaleString();
          else if (v.decidedAt) html += ' - ' + new Date(v.decidedAt).toLocaleString();
          html += '</div>';
          html += '<span class="session-agent-name">Agent: ' + escHtml(agentName) + '</span>';
          html += '</div>';

          if (v.content) {
            html += '<div class="session-content">' + renderMarkdown(v.content) + '</div>';
          } else {
            html += '<div class="session-content"><span class="empty-state" style="padding:8px">Awaiting submission...</span></div>';
          }
          html += '</div>'; // close tl-accent-version
          html += '</div>'; // close session-version

        } else if (evt.type === 'version_deliverable') {
          var v = evt.data;
          var delHtml = '';
          if (v.deliverable) {
            delHtml += '<div class="tl-accent tl-accent-deliverable"><div class="version-deliverable"><div class="version-deliverable-label">Deliverable</div>' + linkifyText(escHtml(v.deliverable)).replace(/\n/g, '<br>') + '</div></div>';
          }
          if (v.result) {
            delHtml += '<div class="tl-accent tl-accent-result"><div class="version-result"><div class="version-result-label">Result</div>' + linkifyText(escHtml(v.result)).replace(/\n/g, '<br>') + '</div></div>';
          }
          if (v.files && v.files.length > 0) {
            var imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
            delHtml += '<div class="tl-accent tl-accent-files"><div class="version-files"><div class="version-files-label">Deliverable Files</div>' +
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
                linkHtml += '<div class="file-quick-actions">';
                if (isImage) {
                  linkHtml += '<button class="btn-quick-add btn-quick-media" onclick="event.stopPropagation();App.openAddToMedia(\'' + escHtml(taskId) + '\',' + v.number + ',\'' + safeName + '\',\'' + rawUrl + '\')">Add to Media</button>';
                }
                if (isText || ext === '.md' || ext === '.txt') {
                  linkHtml += '<button class="btn-quick-add btn-quick-kb" onclick="event.stopPropagation();App.openAddToKb(\'' + escHtml(taskId) + '\',' + v.number + ',\'' + safeName + '\')">Add to KB</button>';
                }
                linkHtml += '</div>';
                linkHtml += '</div>';
                return linkHtml;
              }).join('') + '</div></div>';
          }
          if (delHtml) {
            html += '<div class="session-version-deliverables">' + delHtml + '</div>';
          }

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
          if (v.decidedAt) html += '<span class="session-feedback-date">' + new Date(v.decidedAt).toLocaleString() + '</span>';
          html += '</div>';
          if (v.comments) {
            html += '<div class="session-feedback-text">' + linkifyText(escHtml(v.comments)).replace(/\n/g, '<br>') + '</div>';
          }
          html += '</div>'; // close tl-accent
          html += '</div>';

        } else if (evt.type === 'progress') {
          var entry = evt.data;
          var isBlocker = /blocker/i.test(entry.message);
          var isActiveBlocker = isBlocker && !!task.blocker;
          var isResolvedBlocker = isBlocker && !task.blocker;
          var hasUrl = /(https?:\/\/[^\s]+)/i.test(entry.message);
          var entryClass = 'timeline-progress';
          if (isActiveBlocker) entryClass += ' timeline-progress-blocker';
          if (isResolvedBlocker) entryClass += ' timeline-progress-blocker-resolved';
          if (hasUrl) entryClass += ' timeline-progress-url';
          var agentLabel = entry.agentId || '';
          var agents = state.agents || [];
          for (var ai = 0; ai < agents.length; ai++) {
            if (agents[ai].id === entry.agentId) { agentLabel = agents[ai].name; break; }
          }
          var timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';

          var progressAccent = isActiveBlocker ? 'tl-accent-blocker' : isResolvedBlocker ? 'tl-accent-blocker-resolved' : 'tl-accent-progress';
          html += '<div class="' + entryClass + '">';
          html += '<div class="tl-accent ' + progressAccent + '">';
          if (isActiveBlocker) html += '<span class="progress-blocker-badge">BLOCKER</span> ';
          if (isResolvedBlocker) html += '<span class="progress-blocker-badge progress-blocker-resolved">RESOLVED</span> ';
          html += '<span class="timeline-progress-message">' + linkifyText(escHtml(entry.message)) + '</span>';
          html += '<span class="timeline-progress-meta">' + escHtml(agentLabel) + (timeStr ? ' - ' + timeStr : '') + '</span>';
          html += '</div></div>';

        } else if (evt.type === 'agent_change') {
          var ah = evt.data;
          var ahAgentLabel = ah.agentId || 'Unassigned';
          var agents = state.agents || [];
          for (var ahi = 0; ahi < agents.length; ahi++) {
            if (agents[ahi].id === ah.agentId) { ahAgentLabel = agents[ahi].name; break; }
          }
          var stageLabels = { planning: 'Planning', pending_approval: 'Pending', working: 'Working', done: 'Done', closed: 'Closed', hold: 'Hold', cancelled: 'Cancelled' };
          var ahStage = stageLabels[ah.stage] || ah.stage || '';
          var ahTime = ah.at ? new Date(ah.at).toLocaleString() : '';
          html += '<div class="timeline-agent-change">';
          html += '<div class="tl-accent tl-accent-agent-change">';
          html += '<span class="agent-change-icon">&#8594;</span> ';
          html += '<span class="agent-change-label">' + escHtml(ahAgentLabel) + '</span>';
          html += '<span class="agent-change-stage">' + escHtml(ahStage) + '</span>';
          if (ahTime) html += '<span class="timeline-progress-meta">' + ahTime + '</span>';
          html += '</div></div>';
        }
      });
      html += '</div>'; // close unified-timeline
    }

    // ── Bottom section: status pipeline + feedback ──
    html += buildStatusPipeline(task, versions);

    container.innerHTML = html;
  }

  function buildStatusPipeline(task, versions) {
    var current = task.status || 'planning';
    var hasPlan = versions && versions.length > 0 && versions.some(function(v) { return v.content && v.content.trim(); });

    var steps = [
      { key: 'pending_approval', label: 'Pending',   icon: '&#9679;'  },
      { key: 'working',          label: 'Accept',     icon: '&#10003;', action: 'accept', guardIfNoPlan: true },
      { key: 'done',             label: 'Done',      icon: '&#10004;', action: 'done'  },
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
    var isWorking = current === 'working' || current === 'planning';
    if (isWorking) {
      html += '<span class="pipeline-working-indicator"><span class="agent-working-dot"></span> Working</span>';
    }

    // Autopilot toggle with lock logic for timed tasks
    var isTimed = !!(task.interval || task.scheduledAt);
    if (isTimed) {
      html += '<span class="autopilot-toggle locked active" title="Autopilot is locked while a schedule is active">';
      html += '&#128339; Timed (Autopilot locked)';
      html += '</span>';
    } else {
      html += '<button class="autopilot-toggle' + (task.autopilot ? ' active' : '') + '" onclick="App.toggleTaskAutopilot()" title="Toggle autopilot mode">';
      html += '&#9881; Autopilot ' + (task.autopilot ? 'ON' : 'OFF');
      html += '</button>';
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
        var onclick, title;
        if (s.guardIfNoPlan && !hasPlan) {
          onclick = 'App.acceptWithoutPlanGuard()';
          title = 'Accept - no plan submitted yet';
          cls += ' status-step-no-plan';
        } else {
          onclick = 'App.changeTaskStatus(\'' + s.action + '\')';
          title = 'Set to ' + s.label;
        }
        html += '<button class="' + cls + '" onclick="' + onclick + '" title="' + title + '">';
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
      var isActiveSide = ss.key === current;
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

    // Schedule panel (for timed tasks)
    if (task.interval || task.scheduledAt) {
      var isRecurring = !!(task.interval && task.intervalUnit);
      html += '<div class="schedule-section">';
      html += '<div class="schedule-section-header"><span>Schedule</span><span class="schedule-type-pill">' + (isRecurring ? 'Recurring' : 'One-time') + '</span></div>';
      if (isRecurring) {
        html += '<div class="schedule-data-row"><span class="label">Repeats:</span><span class="value">Every ' + task.interval + ' ' + (task.intervalUnit || '') + '</span></div>';
        if (task.nextRun) {
          var nr = new Date(task.nextRun);
          html += '<div class="schedule-data-row"><span class="label">Next run:</span><span class="value">' + timeAgo(task.nextRun) + ' (' + nr.toLocaleString() + ')</span></div>';
        }
        if (task.lastRun) {
          var lr = new Date(task.lastRun);
          html += '<div class="schedule-data-row"><span class="label">Last run:</span><span class="value">' + timeAgo(task.lastRun) + ' (' + lr.toLocaleString() + ')</span></div>';
        }
        if (task.runCount) {
          html += '<div class="schedule-data-row"><span class="label">Run count:</span><span class="value">' + task.runCount + '</span></div>';
        }
        var schedStatus = task.status === 'hold' ? '<span class="schedule-status-paused">Paused</span>' : '<span class="schedule-status-active">Active</span>';
        html += '<div class="schedule-data-row"><span class="label">Status:</span><span class="value">' + schedStatus + '</span></div>';
        html += '<div class="schedule-actions">';
        if (task.status === 'hold') {
          html += '<button class="btn btn-secondary" onclick="App.resumeSchedule(\'' + task.id + '\')">Resume Schedule</button>';
        } else {
          html += '<button class="btn btn-secondary" onclick="App.pauseSchedule(\'' + task.id + '\')">Pause Schedule</button>';
        }
        html += '<button class="btn btn-secondary" onclick="App.editAutopilot(\'' + task.id + '\')">Edit Interval</button>';
        html += '<button class="btn-danger-subtle" onclick="App.removeSchedule(\'' + task.id + '\')">Remove Schedule</button>';
        html += '</div>';
      } else {
        // One-time scheduled
        var sa = new Date(task.scheduledAt);
        html += '<div class="schedule-data-row"><span class="label">Fires at:</span><span class="value">' + sa.toLocaleString() + ' (' + timeAgo(task.scheduledAt) + ')</span></div>';
        html += '<div class="schedule-data-row"><span class="label">Status:</span><span class="value"><span class="schedule-status-waiting">Waiting</span></span></div>';
        html += '<div class="schedule-actions">';
        html += '<button class="btn btn-secondary" onclick="App.editScheduledAt(\'' + task.id + '\')">Edit Time</button>';
        html += '<button class="btn-danger-subtle" onclick="App.removeSchedule(\'' + task.id + '\')">Remove Schedule</button>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Feedback area (hidden by default)
    html += '<div id="task-feedback-area" class="task-feedback-area hidden">';
    html += '<textarea id="task-review-comments" placeholder="Write feedback for the agent..."></textarea>';
    html += '<div class="task-feedback-actions">';
    html += '<button class="btn btn-primary" onclick="App.reviewTask(\'improve\')">Send Feedback</button>';
    html += '<button class="attach-image-btn" onclick="App.attachTaskImage()" title="Paste image from clipboard"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg> Attach Image</button>';
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
    if (task.result && (current === 'closed' || current === 'done')) {
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
      // Confirm before enabling autopilot (higher-risk action)
      if (newVal) {
        var ok = await confirmAction({
          title: 'Enable Autopilot?',
          message: 'Autopilot lets the agent execute without waiting for your approval. You can turn it off at any time.',
          confirmLabel: 'Enable',
          variant: 'neutral'
        });
        if (!ok) return;
      }
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

    try {
      // Actions that go through the action handler (write version timeline)
      var actionStatuses = { accept: true, done: true, close: true };
      if (actionStatuses[newStatus]) {
        await api.put('/api/tasks/' + id, { action: newStatus });
      } else {
        await api.put('/api/tasks/' + id, { status: newStatus });
      }
      var labels = {
        planning: 'Set to planning', pending_approval: 'Pending review',
        working: 'Working', accept: 'Accepted',
        done: 'Done', close: 'Closed', hold: 'On hold', cancelled: 'Cancelled'
      };
      toast(labels[newStatus] || 'Status updated');

      // After successful Accept, inject PTY message to trigger orchestrator
      if (newStatus === 'accept') {
        if (termWs && termWs.readyState === 1) {
          var task = await api.get('/api/tasks/' + id);
          var msg = 'Task ' + id + ' "' + task.title + '" was accepted and is now working. Launch the assigned agent to execute it.\r';
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


  async function acceptWithoutPlanGuard() {
    var ok = await confirmAction({
      title: 'No plan submitted yet',
      message: 'The agent has not submitted a plan yet. You can switch to autopilot mode to skip the review step, or wait for the agent to submit a plan.',
      confirmLabel: 'Switch to Autopilot & Accept',
      variant: 'warning'
    });
    if (!ok) return;
    var id = state.currentTaskId;
    if (!id) return;
    try {
      await api.put('/api/tasks/' + id, { autopilot: true });
      await changeTaskStatus('accept');
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
            '<button class="attach-image-btn" onclick="App.attachPreviewImage()" title="Paste image from clipboard"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg> Attach Image</button>' +
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

