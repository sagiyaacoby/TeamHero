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

  // ── Voice Input ────────────────────────────────────
  var voiceRecognition = null;
  var voiceIsRecording = false;

  function toggleVoiceInput() {
    var btn = document.getElementById('voice-input-btn');
    var preview = document.getElementById('voice-transcript-preview');
    if (!btn) return;

    if (voiceIsRecording) {
      // Stop recording
      if (voiceRecognition) voiceRecognition.stop();
      return;
    }

    // Start recording
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    var recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    var finalTranscript = '';

    recognition.onstart = function() {
      voiceIsRecording = true;
      finalTranscript = '';
      btn.classList.add('recording');
      btn.title = 'Stop recording';
      if (preview) { preview.textContent = ''; preview.classList.add('active'); }
    };

    recognition.onresult = function(event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (preview) {
        preview.textContent = finalTranscript + interim;
        preview.classList.add('active');
      }
    };

    recognition.onend = function() {
      voiceIsRecording = false;
      btn.classList.remove('recording');
      btn.title = 'Voice input (Speech-to-Text)';
      if (preview) { preview.textContent = ''; preview.classList.remove('active'); }
      voiceRecognition = null;

      // Send final transcript to terminal
      var text = finalTranscript.trim();
      if (text && termWs && termWs.readyState === 1) {
        termWs.send(JSON.stringify({ type: 'input', data: text }));
      }
    };

    recognition.onerror = function(event) {
      voiceIsRecording = false;
      btn.classList.remove('recording');
      btn.title = 'Voice input (Speech-to-Text)';
      if (preview) { preview.textContent = ''; preview.classList.remove('active'); }
      voiceRecognition = null;
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        toast('Voice input error: ' + event.error, 'error');
      }
    };

    voiceRecognition = recognition;
    recognition.start();
  }

  // ── Global Autopilot ─────────────────────────────────
  async function loadGlobalAutopilot() {
    try {
      var data = await api.get('/api/config/autopilot');
      state.globalAutopilot = data.enabled === true;
      renderAutopilotButton();
    } catch(e) {
      console.error('Failed to load autopilot state:', e);
    }
  }

  function renderAutopilotButton() {
    var btn = document.getElementById('btn-global-autopilot');
    var label = document.getElementById('autopilot-status-label');
    if (!btn || !label) return;
    if (state.globalAutopilot) {
      btn.classList.add('active');
      label.textContent = 'ON';
    } else {
      btn.classList.remove('active');
      label.textContent = 'OFF';
    }
  }

  function toggleGlobalAutopilot() {
    var modal = document.getElementById('autopilot-confirm-modal');
    var title = document.getElementById('autopilot-confirm-title');
    if (modal) {
      title.textContent = state.globalAutopilot ? 'Turn Off Autopilot' : 'Turn On Autopilot';
      modal.classList.remove('hidden');
    }
  }

  function cancelAutopilotConfirm() {
    var modal = document.getElementById('autopilot-confirm-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function confirmGlobalAutopilot() {
    var newVal = !state.globalAutopilot;
    try {
      await api.put('/api/config/autopilot', { enabled: newVal });
      state.globalAutopilot = newVal;
      renderAutopilotButton();
    } catch(e) {
      console.error('Failed to toggle autopilot:', e);
    }
    cancelAutopilotConfirm();
  }

