  // ── Skills ───────────────────────────────────────
  var skillsInstalling = {};

  async function loadSkills() {
    try {
      var data = await api.get('/api/skills');
      renderSkills(data.skills || []);
    } catch(e) {
      console.error('Failed to load skills:', e);
      var errGrid = document.getElementById('skills-grid-curated') || document.getElementById('skills-grid');
      if (errGrid) errGrid.innerHTML = '<div class="empty-state">Failed to load skills</div>';
    }
  }

  function renderSkillCard(s) {
    var installing = !!skillsInstalling[s.id];
    var statusText = installing ? 'Installing...' : (s.enabled ? 'Enabled' : 'Not installed');
    var statusClass = installing ? 'installing' : (s.enabled ? 'enabled' : '');
    var cardClass = s.enabled ? 'skill-card enabled' : 'skill-card';
    var isUser = !!s.userInstalled;
    var sourceLabel = s.source === 'registry' ? 'Registry' : s.source === 'npm' ? 'npm' : (isUser ? 'User' : 'Built-in');
    var sourceClass = isUser ? 'user' : 'builtin';
    if (s.source === 'registry') sourceClass = 'registry';
    if (s.source === 'npm') sourceClass = 'npm';
    var sourceBadge = '<span class="skill-source-badge ' + sourceClass + '">' + sourceLabel + '</span>';
    var uninstallBtn = isUser ? ' <button class="skill-uninstall-btn" onclick="event.stopPropagation();App.uninstallUserSkill(' + q + s.id + q + ')">Uninstall</button>' : '';
    var installDate = isUser && s.installedAt ? '<span class="skill-install-date">Installed ' + timeAgo(s.installedAt) + '</span>' : '';
    return '<div class="' + cardClass + '" data-skill-id="' + s.id + '">' +
      '<div class="skill-card-header">' +
        '<div class="skill-card-info">' +
          '<span class="skill-icon">' + (s.icon || '') + '</span>' +
          '<div><div class="skill-card-title">' + escHtml(s.name) + '</div></div>' +
        '</div>' +
        '<label class="toggle-switch">' +
          '<input type="checkbox" ' + (s.enabled ? 'checked' : '') + ' ' + (installing ? 'disabled' : '') +
          ' onchange="App.toggleSkill(' + q + s.id + q + ', this.checked)">' +
          '<span class="toggle-slider"></span>' +
        '</label>' +
      '</div>' +
      '<div class="skill-card-desc">' + escHtml(s.description) + '</div>' +
      (s.missingDeps && s.missingDeps.length && !s.enabled ?
        '<div class="skill-deps-warning">Requires: ' + s.missingDeps.join(', ') + ' (will auto-install)</div>' : '') +
      (s.settings && s.settings.length && s.enabled ? renderSkillSettings(s) : '') +
      (s.id === 'github' && s.enabled ? '<div class="github-status-panel" id="github-status-panel"><span class="text-muted">Checking connection...</span></div>' : '') +
      '<div class="skill-card-footer">' +
        '<span class="skill-type-badge skill-type-' + s.type + '">' + s.type + '</span>' +
        sourceBadge +
        installDate +
        '<span class="skill-status ' + statusClass + '">' + statusText + '</span>' +
        uninstallBtn +
      '</div>' +
    '</div>';
  }

  function renderSkills(skills) {
    var curatedGrid = document.getElementById('skills-grid-curated');
    var userGrid = document.getElementById('skills-grid-user');
    var userSection = document.getElementById('skills-section-user');

    // Fallback for old HTML structure
    if (!curatedGrid) {
      var grid = document.getElementById('skills-grid');
      if (grid) grid.innerHTML = skills.length ? skills.map(renderSkillCard).join('') : '<div class="empty-state">No skills available</div>';
      return;
    }

    // Track loaded skill IDs for cross-referencing in Discover tab
    loadedSkillIds = new Set();
    skills.forEach(function(s) { loadedSkillIds.add(s.id); if (s.sourceId) loadedSkillIds.add(s.sourceId); if (s.npmPackage) loadedSkillIds.add(s.npmPackage); });

    var curated = skills.filter(function(s) { return !s.userInstalled; });
    var userSkills = skills.filter(function(s) { return !!s.userInstalled; });

    // Render curated skills
    if (curated.length) {
      curatedGrid.innerHTML = curated.map(renderSkillCard).join('');
    } else {
      curatedGrid.innerHTML = '<div class="empty-state">No curated skills available</div>';
    }

    // Render user-installed skills
    if (userSkills.length) {
      userGrid.innerHTML = userSkills.map(renderSkillCard).join('');
      userSection.style.display = '';
    } else {
      userGrid.innerHTML = '<div class="empty-state">No custom skills installed. Use the Discover tab to find and install MCP skills.</div>';
      userSection.style.display = '';
    }

    // Load GitHub status if enabled
    var ghCard = document.getElementById('github-status-panel');
    if (ghCard) loadGitHubStatus();
  }

  function renderSkillSettings(skill) {
    var html = '<div class="skill-settings" data-skill="' + skill.id + '">';
    html += '<div class="skill-settings-title">Settings</div>';
    skill.settings.forEach(function(setting) {
      var val = skill.settingValues && skill.settingValues[setting.key] ? skill.settingValues[setting.key] : '';
      var inputType = setting.type === 'secret' ? 'password' : 'text';
      html += '<div class="skill-setting-row">';
      html += '<label>' + escHtml(setting.label) + (setting.required ? ' *' : '') + '</label>';
      html += '<input type="' + inputType + '" data-key="' + setting.key + '" value="' + escHtml(val) + '" placeholder="' + escHtml(setting.help || '') + '">';
      html += '</div>';
    });
    html += '<button class="btn btn-primary btn-sm" onclick="App.saveSkillSettings(' + q + skill.id + q + ')">Save Settings</button>';
    html += '</div>';
    return html;
  }

  async function loadGitHubStatus() {
    var panel = document.getElementById('github-status-panel');
    if (!panel) return;
    try {
      var data = await api.get('/api/skills/github/status');
      var html = '<div class="github-status-row">';
      if (!data.installed) {
        html += '<span class="status-dot red"></span> gh CLI not installed - run <code>winget install GitHub.cli</code>';
      } else if (!data.authenticated) {
        html += '<span class="status-dot red"></span> Not authenticated - run <code>gh auth login</code>';
      } else {
        html += '<span class="status-dot green"></span> Connected as <strong>' + escHtml(data.user || 'unknown') + '</strong>';
      }
      html += '</div>';
      if (data.authenticated && data.repo) {
        html += '<div class="github-status-row"><span class="status-dot green"></span> Repo: <strong>' + escHtml(data.repo.owner ? data.repo.owner.login + '/' + data.repo.name : '') + '</strong></div>';
      } else if (data.authenticated && data.repoError) {
        html += '<div class="github-status-row"><span class="status-dot red"></span> ' + escHtml(data.repoError) + '</div>';
      }
      panel.innerHTML = html;
    } catch(e) {
      panel.innerHTML = '<span class="text-muted">Failed to check status</span>';
    }
  }

  async function saveSkillSettings(skillId) {
    var container = document.querySelector('.skill-settings[data-skill="' + skillId + '"]');
    if (!container) return;
    var inputs = container.querySelectorAll('input[data-key]');
    var settings = {};
    inputs.forEach(function(input) {
      if (input.value.trim()) settings[input.dataset.key] = input.value.trim();
    });
    try {
      await api.put('/api/skills/' + skillId + '/settings', settings);
      toast('Settings saved');
    } catch(e) {
      toast('Failed to save settings: ' + e.message, 'error');
    }
  }

  async function toggleSkill(skillId, enable) {
    var action = enable ? 'enable' : 'disable';
    if (enable) {
      skillsInstalling[skillId] = true;
      loadSkills();
    }
    try {
      var result = await api.post('/api/skills/' + skillId + '/' + action);
      delete skillsInstalling[skillId];
      if (result.ok) {
        toast(enable ? 'Skill enabled' : 'Skill disabled');
      } else {
        var errMsg = result.error || 'Failed to ' + action + ' skill';
        if (result.details) errMsg += '\n' + result.details;
        toast(errMsg, 'error');
        console.error('Skill ' + action + ' failed:', result);
      }
      loadSkills();
    } catch(e) {
      delete skillsInstalling[skillId];
      var msg = (e && e.body && e.body.error) ? e.body.error : (e && e.message) ? e.message : 'Failed to ' + action + ' skill';
      if (e && e.body && e.body.details) msg += '\n' + e.body.details;
      toast(msg, 'error');
      console.error('Skill ' + action + ' failed:', e && e.body ? e.body : e);
      loadSkills();
    }
  }

  // ── Skills Discovery ─────────────────────────────────
  var skillsSearchCursor = null;
  var skillsSearchQuery = '';
  var skillsSearchInstalling = {};
  var loadedSkillIds = new Set();

  function switchSkillsTab(tab) {
    var tabs = document.querySelectorAll('#skills-tabs .tab-btn');
    tabs.forEach(function(t, i) {
      if ((tab === 'installed' && i === 0) || (tab === 'discover' && i === 1)) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });
    var installed = document.getElementById('skills-tab-installed');
    var discover = document.getElementById('skills-tab-discover');
    if (installed) installed.classList.toggle('active', tab === 'installed');
    if (discover) discover.classList.toggle('active', tab === 'discover');
    if (tab === 'installed') loadSkills();
  }

  async function searchDiscoverSkills() {
    var input = document.getElementById('skills-search-input');
    if (!input) return;
    var query = input.value.trim();
    if (!query) return;
    skillsSearchQuery = query;
    skillsSearchCursor = null;
    var results = document.getElementById('skills-search-results');
    var loading = document.getElementById('skills-search-loading');
    var more = document.getElementById('skills-search-more');
    if (results) results.innerHTML = '';
    if (loading) loading.style.display = 'block';
    if (more) more.style.display = 'none';
    try {
      var data = await api.get('/api/skills/search?q=' + encodeURIComponent(query));
      if (loading) loading.style.display = 'none';
      renderSearchResults(data.results || [], false);
      skillsSearchCursor = data.nextCursor || null;
      if (more) more.style.display = skillsSearchCursor ? 'block' : 'none';
    } catch(e) {
      if (loading) loading.style.display = 'none';
      if (results) results.innerHTML = '<div class="empty-state">Search failed: ' + escHtml(e.message || 'Unknown error') + '</div>';
    }
  }

  async function loadMoreSkills() {
    if (!skillsSearchCursor || !skillsSearchQuery) return;
    var loading = document.getElementById('skills-search-loading');
    var more = document.getElementById('skills-search-more');
    if (loading) loading.style.display = 'block';
    if (more) more.style.display = 'none';
    try {
      var data = await api.get('/api/skills/search?q=' + encodeURIComponent(skillsSearchQuery) + '&cursor=' + encodeURIComponent(skillsSearchCursor));
      if (loading) loading.style.display = 'none';
      renderSearchResults(data.results || [], true);
      skillsSearchCursor = data.nextCursor || null;
      if (more) more.style.display = skillsSearchCursor ? 'block' : 'none';
    } catch(e) {
      if (loading) loading.style.display = 'none';
      toast('Failed to load more results', 'error');
    }
  }

  function renderSearchResults(results, append) {
    var grid = document.getElementById('skills-search-results');
    if (!grid) return;
    if (!results.length && !append) {
      grid.innerHTML = '<div class="empty-state">No results found. Try a different search term.</div>';
      return;
    }
    var html = results.map(function(r) {
      var isInstalled = loadedSkillIds.has(r.id) || loadedSkillIds.has(r.npmPackage) || skillsSearchInstalling[r.id] === 'done';
      var isInstalling = skillsSearchInstalling[r.id] === 'installing';
      var btnClass = isInstalled ? 'skill-install-btn installed' : (isInstalling ? 'skill-install-btn installing' : 'skill-install-btn');
      var btnText = isInstalled ? 'Installed' : (isInstalling ? 'Installing...' : 'Install');
      var btnDisabled = isInstalled || isInstalling ? 'disabled' : '';
      var dataAttr = 'data-discover-id="' + escHtml(r.id) + '"';
      var repoLink = r.repoUrl ? '<a href="' + escHtml(r.repoUrl) + '" target="_blank" rel="noopener">Repository</a>' : '';
      var version = r.version ? 'v' + escHtml(r.version) : '';
      var transport = r.transport ? '<span class="skill-type-badge skill-type-mcp">' + escHtml(r.transport) + '</span>' : '';
      return '<div class="skill-card" ' + dataAttr + '>' +
        '<div class="skill-card-header">' +
          '<div class="skill-card-info">' +
            '<span class="skill-icon">&#9670;</span>' +
            '<div><div class="skill-card-title">' + escHtml(r.name || r.title || r.id) + '</div></div>' +
          '</div>' +
          '<button class="' + btnClass + '" ' + btnDisabled + ' onclick="App.installDiscoveredSkill(this)">' + btnText + '</button>' +
        '</div>' +
        '<div class="skill-card-desc">' + escHtml(r.description || 'No description available') + '</div>' +
        '<div class="skill-card-meta">' +
          (version ? '<span>' + version + '</span>' : '') +
          (r.npmPackage ? '<span>' + escHtml(r.npmPackage) + '</span>' : '') +
          repoLink +
        '</div>' +
        '<div class="skill-card-footer">' +
          transport +
          (r.source ? '<span class="skill-source-badge">' + escHtml(r.source) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    if (append) {
      grid.innerHTML += html;
    } else {
      grid.innerHTML = html;
    }
  }

  async function installDiscoveredSkill(btnEl) {
    var card = btnEl.closest('.skill-card');
    if (!card) return;
    var discoverId = card.getAttribute('data-discover-id');
    if (!discoverId || skillsSearchInstalling[discoverId]) return;

    // Gather skill data from the card
    var name = card.querySelector('.skill-card-title') ? card.querySelector('.skill-card-title').textContent : discoverId;
    var desc = card.querySelector('.skill-card-desc') ? card.querySelector('.skill-card-desc').textContent : '';
    var meta = card.querySelectorAll('.skill-card-meta span');
    var version = '';
    var npmPackage = '';
    meta.forEach(function(m) {
      var t = m.textContent;
      if (t.startsWith('v')) version = t.substring(1);
      else if (t.includes('/') || t.startsWith('@')) npmPackage = t;
    });
    var repoLink = card.querySelector('.skill-card-meta a');
    var repoUrl = repoLink ? repoLink.getAttribute('href') : '';

    skillsSearchInstalling[discoverId] = 'installing';
    btnEl.classList.add('installing');
    btnEl.textContent = 'Installing...';
    btnEl.disabled = true;

    try {
      await api.post('/api/skills/user/install', {
        id: discoverId,
        name: name,
        description: desc,
        version: version,
        npmPackage: npmPackage,
        repoUrl: repoUrl
      });
      skillsSearchInstalling[discoverId] = 'done';
      btnEl.classList.remove('installing');
      btnEl.classList.add('installed');
      btnEl.textContent = 'Installed';
      loadedSkillIds.add(discoverId);
      toast('Skill installed: ' + name);
    } catch(e) {
      delete skillsSearchInstalling[discoverId];
      btnEl.classList.remove('installing');
      btnEl.textContent = 'Install';
      btnEl.disabled = false;
      var msg = (e && e.body && e.body.error) ? e.body.error : (e && e.message) ? e.message : 'Install failed';
      toast(msg, 'error');
    }
  }

  async function uninstallUserSkill(skillId) {
    if (!confirm('Uninstall this skill?')) return;
    try {
      await api.del('/api/skills/user/' + skillId);
      toast('Skill uninstalled');
      loadedSkillIds.delete(skillId);
      loadSkills();
    } catch(e) {
      var msg = (e && e.body && e.body.error) ? e.body.error : (e && e.message) ? e.message : 'Uninstall failed';
      toast(msg, 'error');
    }
  }

