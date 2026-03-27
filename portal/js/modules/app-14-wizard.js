  // ── Wizard (6 steps) ──────────────────────────────
  var wizardTeamType = 'custom';
  var wizardCreatedAgents = [];

  var TEAM_TEMPLATES = {
    coding: [
      { name: 'Dev', role: 'Full-Stack Developer', mission: 'Build, enhance, and maintain software across the entire stack', description: 'Writes clean, efficient code across frontend and backend', personality: { traits: ['pragmatic', 'detail-oriented', 'proactive'], tone: 'direct and technical', style: 'concise, code-first' }, capabilities: ['Node.js/Express', 'HTML/CSS/JS', 'REST API design', 'Git workflow'] },
      { name: 'Scout', role: 'Researcher & Analyst', mission: 'Research topics, analyze options, and provide actionable insights', description: 'Investigates questions thoroughly and delivers clear findings', personality: { traits: ['thorough', 'analytical', 'curious'], tone: 'clear and informative', style: 'structured, evidence-based' }, capabilities: ['Web research', 'Competitive analysis', 'Technical evaluation', 'Report writing'] },
      { name: 'Shipper', role: 'Release & GitHub Manager', mission: 'Handle releases, deployments, and version control', description: 'Manages the shipping pipeline from commit to release', personality: { traits: ['organized', 'reliable', 'systematic'], tone: 'professional', style: 'process-oriented' }, capabilities: ['Git operations', 'GitHub releases', 'Version management', 'CI/CD'] },
      { name: 'Pen', role: 'Documentation Writer', mission: 'Create clear, useful documentation and content', description: 'Writes docs, README files, and technical content', personality: { traits: ['clear', 'precise', 'helpful'], tone: 'friendly and professional', style: 'concise, well-structured' }, capabilities: ['Technical writing', 'API documentation', 'User guides', 'Content editing'] }
    ],
    marketing: [
      { name: 'Pen', role: 'Content Writer', mission: 'Create engaging content that drives audience growth', description: 'Writes compelling copy, blog posts, and social content', personality: { traits: ['creative', 'persuasive', 'adaptable'], tone: 'engaging and natural', style: 'story-driven' }, capabilities: ['Blog writing', 'Social media copy', 'Email campaigns', 'SEO content'] },
      { name: 'Pixel', role: 'Designer', mission: 'Create visual assets for brand and marketing', description: 'Designs graphics, social images, and brand materials', personality: { traits: ['creative', 'detail-oriented', 'trend-aware'], tone: 'visual-first', style: 'clean and modern' }, capabilities: ['Social media graphics', 'Brand design', 'Image editing', 'Visual storytelling'] },
      { name: 'Buzz', role: 'Growth Manager', mission: 'Drive audience growth and community engagement', description: 'Manages social presence and community interactions', personality: { traits: ['energetic', 'data-driven', 'social'], tone: 'enthusiastic and authentic', style: 'community-focused' }, capabilities: ['Social media management', 'Community building', 'Growth strategy', 'Analytics'] },
      { name: 'Scout', role: 'Market Researcher', mission: 'Research markets, competitors, and audience trends', description: 'Analyzes market landscape and identifies opportunities', personality: { traits: ['analytical', 'thorough', 'strategic'], tone: 'insightful', style: 'data-backed' }, capabilities: ['Market research', 'Competitor analysis', 'Trend identification', 'Audience insights'] }
    ],
    sales: [
      { name: 'Scout', role: 'Lead Researcher', mission: 'Find and qualify potential leads and prospects', description: 'Researches companies and contacts for outreach', personality: { traits: ['persistent', 'detail-oriented', 'strategic'], tone: 'professional', style: 'thorough' }, capabilities: ['Lead research', 'Company profiling', 'Contact finding', 'Qualification criteria'] },
      { name: 'Pen', role: 'Outreach Writer', mission: 'Write compelling outreach messages and proposals', description: 'Crafts personalized sales messages that convert', personality: { traits: ['persuasive', 'empathetic', 'concise'], tone: 'professional and warm', style: 'personalized' }, capabilities: ['Cold outreach', 'Email sequences', 'Proposals', 'Follow-up messages'] },
      { name: 'Buzz', role: 'Engagement Manager', mission: 'Build and maintain prospect relationships', description: 'Manages ongoing communication and relationship nurturing', personality: { traits: ['personable', 'responsive', 'organized'], tone: 'friendly and professional', style: 'relationship-focused' }, capabilities: ['CRM management', 'Follow-up automation', 'Relationship tracking', 'Pipeline management'] },
      { name: 'Dev', role: 'CRM & Automation', mission: 'Build and maintain sales automation tools', description: 'Creates automations and integrations for the sales pipeline', personality: { traits: ['efficient', 'systematic', 'practical'], tone: 'technical', style: 'solution-oriented' }, capabilities: ['Workflow automation', 'Data integration', 'Report generation', 'Tool setup'] }
    ],
    research: [
      { name: 'Scout', role: 'Primary Researcher', mission: 'Conduct deep research and analysis on assigned topics', description: 'Leads research projects with thorough investigation', personality: { traits: ['analytical', 'meticulous', 'curious'], tone: 'academic and precise', style: 'evidence-based' }, capabilities: ['Deep research', 'Source evaluation', 'Data collection', 'Literature review'] },
      { name: 'Pen', role: 'Report Writer', mission: 'Transform research findings into clear, actionable reports', description: 'Writes well-structured research reports and summaries', personality: { traits: ['clear', 'organized', 'thorough'], tone: 'professional and precise', style: 'structured, readable' }, capabilities: ['Report writing', 'Data visualization', 'Executive summaries', 'Presentation creation'] },
      { name: 'Dev', role: 'Data Analyst', mission: 'Process, analyze, and visualize data for research projects', description: 'Handles data processing and quantitative analysis', personality: { traits: ['methodical', 'accurate', 'efficient'], tone: 'technical', style: 'data-driven' }, capabilities: ['Data processing', 'Statistical analysis', 'Visualization', 'Scripting'] }
    ],
    operations: [
      { name: 'Dev', role: 'Automation Engineer', mission: 'Build and maintain workflow automations', description: 'Creates automated processes to improve efficiency', personality: { traits: ['systematic', 'efficient', 'reliable'], tone: 'technical and clear', style: 'process-oriented' }, capabilities: ['Workflow automation', 'Script development', 'Integration building', 'System monitoring'] },
      { name: 'Scout', role: 'Process Analyst', mission: 'Analyze and optimize operational processes', description: 'Identifies bottlenecks and recommends improvements', personality: { traits: ['analytical', 'observant', 'pragmatic'], tone: 'clear and actionable', style: 'structured' }, capabilities: ['Process mapping', 'Bottleneck analysis', 'Optimization', 'Documentation'] },
      { name: 'Shipper', role: 'Deployment Manager', mission: 'Handle deployments, releases, and system operations', description: 'Manages the operational infrastructure and releases', personality: { traits: ['reliable', 'organized', 'cautious'], tone: 'professional', style: 'checklist-driven' }, capabilities: ['Deployment management', 'Release coordination', 'Monitoring', 'Incident response'] }
    ],
    custom: []
  };

  function wizardNext() {
    // When moving to step 6, trigger team creation
    if (state.wizardStep === 5) {
      wizardCreateTeam();
    }
    if (state.wizardStep < 6) {
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
    document.getElementById('wizard-progress-bar').style.width = Math.round(state.wizardStep / 6 * 100) + '%';
  }

  function wizardSelectType(type) {
    wizardTeamType = type;
    document.querySelectorAll('.wiz-type-card').forEach(function(c) {
      c.classList.toggle('selected', c.dataset.type === type);
    });
  }

  async function wizardCheckClaude() {
    var btn = document.getElementById('wiz-claude-check-btn');
    var status = document.getElementById('wiz-claude-status');
    btn.disabled = true;
    btn.textContent = 'Checking...';
    status.className = 'wiz-claude-status';
    status.textContent = '';
    try {
      var result = await api.post('/api/setup/claude-check', {});
      if (result.found) {
        status.className = 'wiz-claude-status success';
        status.innerHTML = '&#10003; Claude CLI found at ' + escHtml(result.path);
        document.getElementById('wiz-claude-pro-card').style.borderColor = 'var(--green)';
      } else {
        status.className = 'wiz-claude-status error';
        status.innerHTML = 'Claude CLI not found. <a href="https://claude.ai/code" target="_blank" style="color:var(--yellow)">Install Claude Code</a>, then try again.';
      }
    } catch(e) {
      status.className = 'wiz-claude-status error';
      status.textContent = 'Check failed: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = 'Connect Pro/Max';
  }

  async function wizardSaveApiKey() {
    var keyInput = document.getElementById('wiz-api-key');
    var status = document.getElementById('wiz-api-status');
    var key = keyInput.value.trim();
    if (!key) {
      status.className = 'wiz-claude-status error';
      status.textContent = 'Please enter an API key.';
      return;
    }
    status.className = 'wiz-claude-status';
    status.textContent = 'Saving...';
    try {
      // Save connection type to system.json
      var sys = await api.get('/api/system/status');
      sys.claudeConnection = 'api';
      await api.post('/api/write-file', {
        path: 'config/system.json',
        content: JSON.stringify(sys, null, 2)
      });
      status.className = 'wiz-claude-status success';
      status.innerHTML = '&#10003; API key saved.';
      document.getElementById('wiz-claude-api-card').style.borderColor = 'var(--green)';
    } catch(e) {
      status.className = 'wiz-claude-status error';
      status.textContent = 'Save failed: ' + e.message;
    }
  }

  async function wizardCreateTeam() {
    var teamList = document.getElementById('wiz-team-list');
    var creating = document.getElementById('wiz-team-creating');
    var finishBtn = document.getElementById('wiz-finish-btn');
    var titleEl = document.getElementById('wiz-team-title');
    var subtitleEl = document.getElementById('wiz-team-subtitle');
    teamList.innerHTML = '';
    wizardCreatedAgents = [];

    // Save profile first
    var nameVal = (document.getElementById('wiz-name') || {}).value || '';
    var roleVal = (document.getElementById('wiz-role') || {}).value || '';
    var goalsVal = (document.getElementById('wiz-goals') || {}).value || '';
    if (nameVal.trim() || roleVal.trim() || goalsVal.trim()) {
      try {
        await api.put('/api/profile', {
          name: nameVal.trim(),
          role: roleVal.trim(),
          goals: goalsVal.trim()
        });
      } catch(e) { console.error('Profile save error:', e); }
    }

    // Save orchestrator name
    var orchName = (document.getElementById('wiz-orch-name') || {}).value || 'Hero';
    if (orchName.trim()) {
      try {
        await api.put('/api/agents/orchestrator', { name: orchName.trim() });
      } catch(e) { console.error('Orchestrator rename error:', e); }
    }

    // Save system config with team type and connection
    try {
      var sys = await api.get('/api/system/status');
      sys.teamType = wizardTeamType;
      sys.disclaimerAcceptedAt = sys.disclaimerAcceptedAt || new Date().toISOString();
      await api.post('/api/write-file', {
        path: 'config/system.json',
        content: JSON.stringify(sys, null, 2)
      });
    } catch(e) { console.error('System config save error:', e); }

    var template = TEAM_TEMPLATES[wizardTeamType] || [];

    if (template.length === 0) {
      // Custom - no agents to create
      titleEl.textContent = 'Your team is ready!';
      subtitleEl.textContent = 'You chose a custom team. Add agents from the dashboard anytime.';
      // Show just the orchestrator
      var orchItem = wizardRenderTeamItem({ id: 'orchestrator', name: orchName.trim() || 'Hero', role: 'Team Orchestrator' }, true);
      teamList.appendChild(orchItem);
      return;
    }

    // Show creating state
    creating.style.display = 'flex';
    finishBtn.disabled = true;

    // Initialize system first so we can create agents
    try {
      await api.post('/api/system/initialize', {});
    } catch(e) { console.error('Init error:', e); }

    // Create agents
    for (var i = 0; i < template.length; i++) {
      try {
        var agent = await api.post('/api/agents', template[i]);
        wizardCreatedAgents.push(agent);
      } catch(e) {
        console.error('Failed to create agent:', template[i].name, e);
      }
    }

    creating.style.display = 'none';
    finishBtn.disabled = false;

    // Render orchestrator first
    var orchEl = wizardRenderTeamItem({ id: 'orchestrator', name: orchName.trim() || 'Hero', role: 'Team Orchestrator' }, true);
    teamList.appendChild(orchEl);

    // Render created agents
    for (var j = 0; j < wizardCreatedAgents.length; j++) {
      var el = wizardRenderTeamItem(wizardCreatedAgents[j], false);
      teamList.appendChild(el);
    }

    titleEl.textContent = 'Your team is ready!';
    subtitleEl.textContent = 'We created ' + wizardCreatedAgents.length + ' agents for your ' + wizardTeamType + ' team:';
  }

  function wizardRenderTeamItem(agent, isOrch) {
    var div = document.createElement('div');
    div.className = 'wiz-team-item';
    div.dataset.agentId = agent.id;

    var icon = isOrch ? '&#9733;' : '&#9679;';
    var nameClass = isOrch ? 'wiz-team-item-name orch' : 'wiz-team-item-name';

    var html = '<div class="wiz-team-item-icon">' + icon + '</div>' +
      '<div class="wiz-team-item-info">' +
        '<div class="' + nameClass + '" id="wiz-agent-name-' + agent.id + '">' + escHtml(agent.name) + '</div>' +
        '<div class="wiz-team-item-role">' + escHtml(agent.role) + '</div>' +
      '</div>';

    if (!isOrch) {
      html += '<div class="wiz-team-item-actions">' +
        '<button class="btn btn-sm btn-secondary" onclick="App.wizardRenameAgent(\'' + agent.id + '\')">Rename</button>' +
        '<button class="btn btn-sm btn-cancel" onclick="App.wizardRemoveAgent(\'' + agent.id + '\')">Remove</button>' +
      '</div>';
    }

    div.innerHTML = html;
    return div;
  }

  async function wizardRenameAgent(agentId) {
    var nameEl = document.getElementById('wiz-agent-name-' + agentId);
    if (!nameEl) return;
    var currentName = nameEl.textContent;
    nameEl.innerHTML = '<input type="text" class="wiz-team-rename-input" value="' + escHtml(currentName) + '" id="wiz-rename-input-' + agentId + '" onkeydown="if(event.key===\'Enter\')App.wizardConfirmRename(\'' + agentId + '\')" autofocus>';
    var input = document.getElementById('wiz-rename-input-' + agentId);
    if (input) { input.focus(); input.select(); }
  }

  async function wizardConfirmRename(agentId) {
    var input = document.getElementById('wiz-rename-input-' + agentId);
    if (!input) return;
    var newName = input.value.trim();
    if (!newName) return;
    try {
      await api.put('/api/agents/' + agentId, { name: newName });
      var nameEl = document.getElementById('wiz-agent-name-' + agentId);
      if (nameEl) nameEl.textContent = newName;
      // Update local cache
      for (var i = 0; i < wizardCreatedAgents.length; i++) {
        if (wizardCreatedAgents[i].id === agentId) wizardCreatedAgents[i].name = newName;
      }
    } catch(e) {
      toast('Rename failed: ' + e.message, 'error');
    }
  }

  async function wizardRemoveAgent(agentId) {
    try {
      await api.del('/api/agents/' + agentId);
      var item = document.querySelector('.wiz-team-item[data-agent-id="' + agentId + '"]');
      if (item) item.remove();
      wizardCreatedAgents = wizardCreatedAgents.filter(function(a) { return a.id !== agentId; });
      var subtitleEl = document.getElementById('wiz-team-subtitle');
      if (subtitleEl && wizardCreatedAgents.length > 0) {
        subtitleEl.textContent = wizardCreatedAgents.length + ' agent' + (wizardCreatedAgents.length !== 1 ? 's' : '') + ' in your team:';
      }
    } catch(e) {
      toast('Remove failed: ' + e.message, 'error');
    }
  }

  async function wizardFinish() {
    try {
      // Ensure system is initialized
      await api.post('/api/system/initialize', {});

      // Read current system config and set teamName
      var sys = await api.get('/api/system/status');
      var teamName = sys.teamName || 'My Team';
      updateSidebarHeader(teamName);
      document.getElementById('wizard-overlay').classList.add('hidden');
      await loadSidebarAgents();
      navigate('chat');
      toast('Team setup complete! Talk to your sidekick in the Command Center.');
    } catch(e) {
      toast('Setup failed: ' + e.message, 'error');
      console.error(e);
    }
  }

  async function wizardSkip() {
    try {
      await api.post('/api/write-file', {
        path: 'config/system.json',
        content: JSON.stringify({ initialized: true, teamName: 'My Team', teamDescription: '', version: '1.0.0', disclaimerAcceptedAt: new Date().toISOString() }, null, 2)
      });
      await api.post('/api/system/initialize', {});
      updateSidebarHeader('My Team');
      document.getElementById('wizard-overlay').classList.add('hidden');
      await loadSidebarAgents();
      navigate('chat');
      toast('Setup skipped - you can configure your profile in Settings anytime.');
    } catch(e) {
      toast('Skip failed: ' + e.message, 'error');
      console.error(e);
    }
  }

  function updateSidebarHeader(teamName) {
    var header = document.getElementById('sidebar-header');
    header.innerHTML = '<h1>&#9881; ' + escHtml(teamName || 'Team') + '</h1><span class="subtitle">Agent Portal</span>';
  }

