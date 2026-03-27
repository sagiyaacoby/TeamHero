  // ── Model Routing ─────────────────────────────────────
  var MODEL_DISPLAY = { opus: 'Opus 4.6', sonnet: 'Sonnet 4.6', haiku: 'Haiku 4.5' };

  async function loadModelRoutingState() {
    try {
      state.modelRouting = await api.get('/api/settings/model-routing');
    } catch(e) {
      state.modelRouting = { mode: 'default' };
    }
  }
  var TASK_TYPES = ['general', 'research', 'development', 'content', 'review', 'operations'];

  async function renderModelRoutingSettings() {
    var container = document.getElementById('model-routing-content');
    if (!container) return;
    try {
      var config = await api.get('/api/settings/model-routing');
      var agentsData = await api.get('/api/agents');
      var agents = agentsData.agents || [];
      state.modelRouting = config;

      var html = '';
      // Mode selector
      html += '<div class="model-routing-modes">';
      var modes = [
        { value: 'default', label: 'Default', desc: 'All agents use your configured Claude model. No optimization applied.' },
        { value: 'manual', label: 'Manual', desc: 'Choose a model for each agent. Use presets for quick setup.' },
        { value: 'smart', label: 'Smart', desc: 'Platform auto-selects the optimal model based on task type, complexity, and agent role.' }
      ];
      modes.forEach(function(mode) {
        var isActive = config.mode === mode.value;
        html += '<label class="model-routing-mode-option' + (isActive ? ' active' : '') + '">';
        html += '<input type="radio" name="model-routing-mode" value="' + mode.value + '"' + (isActive ? ' checked' : '') + ' onchange="App.saveModelRoutingMode(\'' + mode.value + '\')">';
        html += '<div><div class="model-routing-mode-label">' + mode.label + '</div>';
        html += '<div class="model-routing-mode-desc">' + mode.desc + '</div></div>';
        html += '</label>';
      });
      html += '</div>';

      // Manual mode panel
      if (config.mode === 'manual') {
        html += '<div class="mr-section-label">Presets</div>';
        html += '<div class="preset-buttons" id="preset-buttons"></div>';
        html += '<div class="mr-section-label">Agent Model Assignments</div>';
        html += '<table class="model-table"><thead><tr><th>Agent</th><th>Role</th><th>Model</th><th></th></tr></thead><tbody>';
        agents.forEach(function(a) {
          var model = a.isOrchestrator ? (config.orchestratorModel || '') : ((config.agentModels || {})[a.id] || '');
          var modelDisplay = model ? MODEL_DISPLAY[model] || model : 'System Default';
          html += '<tr><td>' + escHtml(a.name) + '</td><td style="color:var(--text-muted)">' + escHtml(a.role || '-') + '</td>';
          html += '<td class="model-cell">' + modelDisplay + '</td>';
          if (!a.isOrchestrator) {
            html += '<td><a class="model-edit-link" href="#" onclick="event.preventDefault();App.navigate(\'agent-detail\');App.loadAgentDetail(\'' + a.id + '\')">Edit</a></td>';
          } else {
            html += '<td></td>';
          }
          html += '</tr>';
        });
        html += '</tbody></table>';
      }

      // Smart mode panel
      if (config.mode === 'smart') {
        var sc = config.smartConfig || {};
        html += '<div class="smart-config-section">';

        // Show routing decisions checkbox
        html += '<div class="smart-config-row">';
        html += '<input type="checkbox" id="mr-show-decisions"' + (sc.showRoutingDecision !== false ? ' checked' : '') + ' onchange="App.saveModelRoutingConfig({smartConfig:{showRoutingDecision:this.checked}})">';
        html += '<label for="mr-show-decisions" style="font-size:13px">Show routing decisions in task logs</label>';
        html += '</div>';

        // Floor / Ceiling
        html += '<div class="smart-config-row">';
        html += '<span class="smart-config-label">Model Floor:</span>';
        html += '<select onchange="App.saveModelRoutingConfig({smartConfig:{minModel:this.value}})">';
        ['haiku', 'sonnet', 'opus'].forEach(function(m) {
          html += '<option value="' + m + '"' + ((sc.minModel || 'haiku') === m ? ' selected' : '') + '>' + MODEL_DISPLAY[m] + '</option>';
        });
        html += '</select></div>';

        html += '<div class="smart-config-row">';
        html += '<span class="smart-config-label">Model Ceiling:</span>';
        html += '<select onchange="App.saveModelRoutingConfig({smartConfig:{maxModel:this.value}})">';
        ['haiku', 'sonnet', 'opus'].forEach(function(m) {
          html += '<option value="' + m + '"' + ((sc.maxModel || 'opus') === m ? ' selected' : '') + '>' + MODEL_DISPLAY[m] + '</option>';
        });
        html += '</select></div>';

        // Agent overrides
        html += '<h4>Agent Overrides</h4>';
        html += '<table class="override-table">';
        var ao = sc.agentOverrides || {};
        Object.keys(ao).forEach(function(agentId) {
          var agentObj = agents.find(function(a) { return a.id === agentId; });
          var agentName = agentObj ? agentObj.name : agentId;
          html += '<tr><td>' + escHtml(agentName) + '</td><td>';
          html += '<select onchange="App.updateSmartAgentOverride(\'' + agentId + '\',this.value)">';
          ['haiku', 'sonnet', 'opus'].forEach(function(m) {
            html += '<option value="' + m + '"' + (ao[agentId] === m ? ' selected' : '') + '>' + MODEL_DISPLAY[m] + '</option>';
          });
          html += '</select></td>';
          html += '<td><button class="override-remove-btn" onclick="App.removeSmartAgentOverride(\'' + agentId + '\')">&times; Remove</button></td></tr>';
        });
        html += '</table>';
        // Add override button
        var availableAgents = agents.filter(function(a) { return !ao[a.id] && !a.isOrchestrator; });
        if (availableAgents.length > 0) {
          html += '<button class="override-add-btn" onclick="App.addSmartAgentOverride()">+ Add agent override</button>';
        }

        // Task type overrides
        html += '<h4>Task Type Overrides</h4>';
        html += '<table class="override-table">';
        var tto = sc.taskTypeOverrides || {};
        Object.keys(tto).forEach(function(tt) {
          html += '<tr><td>' + escHtml(tt) + '</td><td>';
          html += '<select onchange="App.updateSmartTaskTypeOverride(\'' + tt + '\',this.value)">';
          ['haiku', 'sonnet', 'opus'].forEach(function(m) {
            html += '<option value="' + m + '"' + (tto[tt] === m ? ' selected' : '') + '>' + MODEL_DISPLAY[m] + '</option>';
          });
          html += '</select></td>';
          html += '<td><button class="override-remove-btn" onclick="App.removeSmartTaskTypeOverride(\'' + tt + '\')">&times; Remove</button></td></tr>';
        });
        html += '</table>';
        var usedTypes = Object.keys(tto);
        var availableTypes = TASK_TYPES.filter(function(t) { return usedTypes.indexOf(t) === -1; });
        if (availableTypes.length > 0) {
          html += '<button class="override-add-btn" onclick="App.addSmartTaskTypeOverride()">+ Add type override</button>';
        }

        html += '<br><button class="smart-reset-btn" onclick="App.resetSmartConfig()">Reset to defaults</button>';
        html += '</div>';
      }

      container.innerHTML = html;

      // Load presets for manual mode
      if (config.mode === 'manual') {
        loadPresetButtons();
      }
    } catch(e) {
      container.innerHTML = '<p style="color:var(--text-muted)">Failed to load model routing settings.</p>';
      console.error('Model routing load error:', e);
    }
  }

  async function loadPresetButtons() {
    var container = document.getElementById('preset-buttons');
    if (!container) return;
    try {
      var data = await api.get('/api/settings/model-routing/presets');
      var html = '';
      (data.presets || []).forEach(function(p) {
        html += '<button class="preset-btn" onclick="App.applyModelPreset(\'' + p.name + '\')">';
        html += '<span class="preset-name">' + p.name.charAt(0).toUpperCase() + p.name.slice(1) + '</span>';
        html += '<span class="preset-savings">' + escHtml(p.savings) + ' savings</span>';
        html += '</button>';
      });
      container.innerHTML = html;
    } catch(e) { console.error('Failed to load presets:', e); }
  }

  async function saveModelRoutingMode(mode) {
    try {
      await api.put('/api/settings/model-routing', { mode: mode });
      toast('Model routing mode updated');
      renderModelRoutingSettings();
    } catch(e) { toast('Failed to update mode', 'error'); }
  }

  async function applyModelPreset(name) {
    try {
      await api.post('/api/settings/model-routing/presets/' + name, {});
      toast('Preset "' + name + '" applied');
      renderModelRoutingSettings();
    } catch(e) { toast('Failed to apply preset', 'error'); }
  }

  async function saveModelRoutingConfig(updates) {
    try {
      await api.put('/api/settings/model-routing', updates);
      toast('Settings saved');
      renderModelRoutingSettings();
    } catch(e) { toast(e.message || 'Failed to save', 'error'); }
  }

  async function addSmartAgentOverride() {
    try {
      var agentsData = await api.get('/api/agents');
      var config = await api.get('/api/settings/model-routing');
      var ao = (config.smartConfig && config.smartConfig.agentOverrides) || {};
      var available = (agentsData.agents || []).filter(function(a) { return !ao[a.id] && !a.isOrchestrator; });
      if (available.length === 0) { toast('All agents have overrides'); return; }
      var agent = available[0];
      ao[agent.id] = 'sonnet';
      await api.put('/api/settings/model-routing', { smartConfig: { agentOverrides: ao } });
      renderModelRoutingSettings();
    } catch(e) { toast('Failed to add override', 'error'); }
  }

  async function removeSmartAgentOverride(agentId) {
    try {
      var config = await api.get('/api/settings/model-routing');
      var ao = (config.smartConfig && config.smartConfig.agentOverrides) || {};
      delete ao[agentId];
      await api.put('/api/settings/model-routing', { smartConfig: { agentOverrides: ao } });
      renderModelRoutingSettings();
    } catch(e) { toast('Failed to remove override', 'error'); }
  }

  async function updateSmartAgentOverride(agentId, model) {
    try {
      var config = await api.get('/api/settings/model-routing');
      var ao = (config.smartConfig && config.smartConfig.agentOverrides) || {};
      ao[agentId] = model;
      await api.put('/api/settings/model-routing', { smartConfig: { agentOverrides: ao } });
      toast('Override updated');
    } catch(e) { toast('Failed to update', 'error'); }
  }

  async function addSmartTaskTypeOverride() {
    try {
      var config = await api.get('/api/settings/model-routing');
      var tto = (config.smartConfig && config.smartConfig.taskTypeOverrides) || {};
      var usedTypes = Object.keys(tto);
      var available = TASK_TYPES.filter(function(t) { return usedTypes.indexOf(t) === -1; });
      if (available.length === 0) { toast('All task types have overrides'); return; }
      tto[available[0]] = 'sonnet';
      await api.put('/api/settings/model-routing', { smartConfig: { taskTypeOverrides: tto } });
      renderModelRoutingSettings();
    } catch(e) { toast('Failed to add override', 'error'); }
  }

  async function removeSmartTaskTypeOverride(taskType) {
    try {
      var config = await api.get('/api/settings/model-routing');
      var tto = (config.smartConfig && config.smartConfig.taskTypeOverrides) || {};
      delete tto[taskType];
      await api.put('/api/settings/model-routing', { smartConfig: { taskTypeOverrides: tto } });
      renderModelRoutingSettings();
    } catch(e) { toast('Failed to remove override', 'error'); }
  }

  async function updateSmartTaskTypeOverride(taskType, model) {
    try {
      var config = await api.get('/api/settings/model-routing');
      var tto = (config.smartConfig && config.smartConfig.taskTypeOverrides) || {};
      tto[taskType] = model;
      await api.put('/api/settings/model-routing', { smartConfig: { taskTypeOverrides: tto } });
      toast('Override updated');
    } catch(e) { toast('Failed to update', 'error'); }
  }

  async function resetSmartConfig() {
    if (!confirm('Reset Smart routing to defaults?')) return;
    try {
      await api.put('/api/settings/model-routing', {
        smartConfig: {
          agentOverrides: {},
          taskTypeOverrides: {},
          showRoutingDecision: true,
          minModel: 'haiku',
          maxModel: 'opus'
        }
      });
      toast('Smart config reset');
      renderModelRoutingSettings();
    } catch(e) { toast('Failed to reset', 'error'); }
  }

  async function saveAgentModel() {
    var model = document.getElementById('agent-model-select').value || null;
    try {
      var update = { agentModels: {} };
      update.agentModels[state.currentAgentId] = model;
      await api.put('/api/settings/model-routing', update);
      toast('Model updated');
      // Refresh info text
      var config = await api.get('/api/settings/model-routing');
      state.modelRouting = config;
      updateAgentModelInfo(config);
    } catch(e) { toast('Failed to update model', 'error'); }
  }

  function updateAgentModelInfo(config) {
    var infoEl = document.getElementById('agent-model-info');
    var barEl = document.getElementById('agent-model-bar');
    if (!infoEl || !barEl) return;
    var mode = config.mode || 'default';
    if (mode === 'default') {
      infoEl.textContent = 'Model routing is set to Default. This setting takes effect in Manual/Smart mode.';
      barEl.classList.add('dimmed');
    } else if (mode === 'manual') {
      infoEl.textContent = 'This model will be used for all tasks assigned to this agent.';
      barEl.classList.remove('dimmed');
    } else {
      infoEl.textContent = 'This setting is registered as a Smart mode override.';
      barEl.classList.remove('dimmed');
    }
  }

