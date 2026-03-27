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

    // Sort by status priority helper
    var statusPriority = { working: 0, pending_approval: 1, planning: 2, done: 3, hold: 4, closed: 5, cancelled: 6 };
    function statusSort(a, b) {
      var sa = statusPriority[a.status] !== undefined ? statusPriority[a.status] : 8;
      var sb = statusPriority[b.status] !== undefined ? statusPriority[b.status] : 8;
      return sa - sb;
    }

    // Build parent-children groups for clustered layout
    // A "parent" here is a col-0 task that has subtasks visible in the graph
    var parentGroups = []; // [{parent: task, children: [tasks in col 1+]}]
    var orphans = [];      // col-0 tasks with no subtasks
    var childrenPlaced = {}; // track which children are placed via a parent group

    // Identify col-0 tasks that have subtask children
    var col0 = columns[0] || [];
    col0.sort(statusSort);
    col0.forEach(function(t) {
      var kids = [];
      if (t.subtasks && t.subtasks.length > 0) {
        t.subtasks.forEach(function(sid) {
          if (nodeSet[sid] && colMap[sid] > 0) {
            kids.push(taskMap[sid]);
            childrenPlaced[sid] = true;
          }
        });
      }
      if (kids.length > 0) {
        kids.sort(statusSort);
        parentGroups.push({ parent: t, children: kids });
      } else {
        orphans.push(t);
      }
    });

    // Compute positions: lay out groups first, then orphans, then remaining unplaced nodes
    var canvasH = 0;
    var curY = padY;
    var groupGapY = 28; // extra gap between groups

    // Lay out parent groups: parent at col 0, children at their assigned columns, all vertically clustered
    parentGroups.forEach(function(group) {
      var parentX = padX + (colMap[group.parent.id] || 0) * nodeGapX;
      var childCount = group.children.length;
      // Total height of children block
      var childrenBlockH = childCount * nodeH + (childCount - 1) * nodeGapY;
      // Parent is vertically centered relative to its children
      var parentY, childStartY;
      if (childrenBlockH > nodeH) {
        childStartY = curY;
        parentY = curY + (childrenBlockH - nodeH) / 2;
      } else {
        parentY = curY;
        childStartY = curY + (nodeH - childrenBlockH) / 2;
      }
      nodePositions[group.parent.id] = { x: parentX, y: parentY, w: nodeW, h: nodeH };
      var cy = childStartY;
      group.children.forEach(function(child) {
        var childCol = colMap[child.id] || 1;
        var childX = padX + childCol * nodeGapX;
        nodePositions[child.id] = { x: childX, y: cy, w: nodeW, h: nodeH };
        cy += nodeH + nodeGapY;
      });
      var groupBottom = Math.max(parentY + nodeH, childStartY + childrenBlockH);
      curY = groupBottom + groupGapY;
    });

    // Lay out orphan col-0 tasks (no subtasks)
    if (orphans.length > 0) {
      var orphanX = padX;
      orphans.forEach(function(t) {
        nodePositions[t.id] = { x: orphanX, y: curY, w: nodeW, h: nodeH };
        curY += nodeH + nodeGapY;
      });
    }

    // Lay out any remaining nodes not yet placed (e.g. col 1+ nodes that aren't subtasks of a col-0 parent)
    nodes.forEach(function(t) {
      if (nodePositions[t.id]) return;
      var col = colMap[t.id] || 0;
      var x = padX + col * nodeGapX;
      nodePositions[t.id] = { x: x, y: curY, w: nodeW, h: nodeH };
      curY += nodeH + nodeGapY;
    });

    canvasH = curY;
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
    planning: 'planning', working: 'working', pending_approval: 'pending',
    done: 'done', closed: 'closed',
    hold: 'hold', cancelled: 'cancelled',
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
    var isWorking = t.status === 'working';
    var workingDot = isWorking ? '<span class="agent-working-dot" title="Working"></span>' : '';
    var autopilotIcon = '';
    if (t.interval || t.scheduledAt) {
      var scheduleLabel = t.interval ? 'Every ' + t.interval + ' ' + (t.intervalUnit || '') : 'Scheduled';
      autopilotIcon = '<span class="timed-badge" title="' + scheduleLabel + '">&#128339;</span>';
    } else if (t.autopilot) {
      autopilotIcon = '<span class="autopilot-badge" title="Autopilot">&#9881;</span>';
    }
    var scheduleInfo = '';
    if (t.interval && t.intervalUnit) {
      scheduleInfo = '<span class="schedule-info-mini">' + formatIntervalFields(t.interval, t.intervalUnit) + '</span>';
      if (t.runCount) scheduleInfo += '<span class="run-count-mini">#' + t.runCount + '</span>';
    } else if (t.scheduledAt) {
      var sd = new Date(t.scheduledAt);
      scheduleInfo = '<span class="schedule-info-mini">' + sd.toLocaleDateString(undefined, {month:'short',day:'numeric'}) + '</span>';
    }
    var blocked = isTaskBlocked(t, state.tasks);
    var blockedBadge = blocked ? '<span class="badge badge-blocked">blocked</span>' : '';
    var hasBlocker = !!t.blocker;
    var blockerBadge = hasBlocker ? '<span class="blocker-badge-small">BLOCKER</span>' : '';
    var isStalePlanning = t.status === 'planning' && t.stalePlanning;
    var stalePlanningBadge = isStalePlanning ? '<span class="stale-planning-badge" title="No agent active - task stuck in planning">&#9888; no agent</span>' : '';
    var isInterrupted = !!t.interrupted && (t.status === 'working' || t.status === 'planning');
    var interruptedBadge = isInterrupted ? '<span class="interrupted-badge" title="Agent session lost - task stalled">&#9888;</span>' : '';
    var subtaskClass = isSubtask ? ' subtask-item' : '';
    var blockerClass = hasBlocker ? ' task-has-blocker' : '';
    var interruptedClass = isInterrupted ? ' task-interrupted' : '';
    var stalePlanningClass = isStalePlanning ? ' task-stale-planning' : '';
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
      var isOverdue = dueDate < now && t.status !== 'closed' && t.status !== 'done';
      dueDateHtml = '<span class="task-due' + (isOverdue ? ' task-due-overdue' : '') + '" title="Due: ' + dueDate.toLocaleDateString() + '">' + dueDate.toLocaleDateString() + '</span>';
    }
    var timeAgoHtml = t.createdAt ? '<span class="task-time-ago">' + timeAgo(t.createdAt) + '</span>' : '';

    return '<div class="task-item' + subtaskClass + blockerClass + interruptedClass + stalePlanningClass + '"' + depthStyle + ' onclick="App.openTask(' + q + t.id + q + ')">' +
      '<span class="task-title">' + outputIcon + autopilotIcon + escHtml(t.title) + scheduleInfo + tagPills + '</span>' +
      '<span class="task-meta">' +
        '<span class="badge ' + priorityClass + '">' + escHtml(t.priority || 'medium') + '</span>' +
        '<span class="badge ' + statusClass + '">' + escHtml(statusLabel) + workingDot + interruptedBadge + '</span>' +
        blockedBadge + blockerBadge + stalePlanningBadge +
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

  async function filterTasks(filter, context) {
    if (context === 'dashboard') {
      state.dashboardTaskFilter = filter;
      // Update stat card highlights
      document.querySelectorAll('.stat-card[data-filter]').forEach(function(card) {
        card.classList.toggle('stat-card-active', card.dataset.filter === filter);
      });
      // Update panel title text without destroying the view-mode-toggle buttons inside the h3
      var titleEl = document.getElementById('dashboard-tasks-title');
      if (titleEl) {
        var labels = { pending: 'Pending', working: 'Working', done: 'Done', hold: 'On Hold', cancelled: 'Cancelled', closed: 'Closed' };
        var titleText = labels[filter] || filter.replace(/_/g, ' ');
        var firstText = titleEl.firstChild;
        if (firstText && firstText.nodeType === 3) {
          firstText.textContent = titleText + '\n        ';
        } else {
          titleEl.insertBefore(document.createTextNode(titleText + '\n        '), titleEl.firstChild);
        }
      }
      // For closed/cancelled filters, fetch with archive included
      if (filter === 'closed' || filter === 'cancelled') {
        try {
          var archiveData = await api.get('/api/tasks?include=archive');
          var archiveTasks = archiveData.tasks || [];
          var fullArchiveTasks = await Promise.all(archiveTasks.map(function(t) {
            return api.get('/api/tasks/' + t.id).catch(function() { return Object.assign({ priority: 'medium' }, t); });
          }));
          state.cachedDashboardTasks = fullArchiveTasks;
        } catch(e) { console.error('Failed to load archive tasks:', e); }
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
      // For closed/cancelled filters on agent page, fetch with archive included
      if (filter === 'closed' || filter === 'cancelled') {
        try {
          var archiveData = await api.get('/api/tasks?include=archive');
          var agentId = state.currentAgent ? state.currentAgent.id : null;
          var archiveTasks = (archiveData.tasks || []).filter(function(t) { return t.assignedTo === agentId; });
          var fullArchiveTasks = await Promise.all(archiveTasks.map(function(t) {
            return api.get('/api/tasks/' + t.id).catch(function() { return Object.assign({ priority: 'medium' }, t); });
          }));
          state.cachedAgentTasks = fullArchiveTasks;
        } catch(e) { console.error('Failed to load archive tasks:', e); }
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
    if (tab === 'stats' && state.currentAgentId) {
      loadAgentStats(state.currentAgentId);
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

