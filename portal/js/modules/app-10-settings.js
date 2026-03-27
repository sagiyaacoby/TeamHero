  // ── Agent CRUD ─────────────────────────────────────
  function clearAgentForm() {
    ['af-name','af-role','af-mission','af-desc','af-traits','af-tone','af-style','af-rules','af-caps'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
  }

  function fillAgentForm(agent) {
    document.getElementById('af-name').value = agent.name || '';
    document.getElementById('af-role').value = agent.role || '';
    document.getElementById('af-mission').value = agent.mission || '';
    document.getElementById('af-desc').value = agent.description || '';
    var p = agent.personality || {};
    document.getElementById('af-traits').value = (p.traits || []).join(', ');
    document.getElementById('af-tone').value = p.tone || '';
    document.getElementById('af-style').value = p.style || '';
    document.getElementById('af-rules').value = (agent.rules || []).join('\n');
    document.getElementById('af-caps').value = (agent.capabilities || []).join(', ');
  }

  function getAgentFormData() {
    return {
      name: document.getElementById('af-name').value.trim(),
      role: document.getElementById('af-role').value.trim(),
      mission: document.getElementById('af-mission').value.trim(),
      description: document.getElementById('af-desc').value.trim(),
      personality: {
        traits: document.getElementById('af-traits').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
        tone: document.getElementById('af-tone').value.trim(),
        style: document.getElementById('af-style').value.trim(),
      },
      rules: document.getElementById('af-rules').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean),
      capabilities: document.getElementById('af-caps').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    };
  }

  async function saveAgent() {
    var data = getAgentFormData();
    if (!data.name) { toast('Agent name is required', 'error'); return; }

    try {
      if (state.editingAgentId) {
        await api.put('/api/agents/' + state.editingAgentId, data);
        toast('Agent updated');
        navigate('agent-detail', state.editingAgentId);
      } else {
        var created = await api.post('/api/agents', data);
        toast('Agent created');
        navigate('agent-detail', created.id);
      }
    } catch(e) {
      toast('Failed to save agent', 'error');
      console.error(e);
    }
  }

  async function editAgent() {
    if (!state.currentAgentId) return;
    try {
      var agent = await api.get('/api/agents/' + state.currentAgentId);
      state.editingAgentId = state.currentAgentId;
      navigate('add-agent');
      document.getElementById('agent-form-title').textContent = 'Edit Agent';
      document.getElementById('af-submit').textContent = 'Save Changes';
      fillAgentForm(agent);
    } catch(e) {
      toast('Failed to load agent for editing', 'error');
    }
  }

  async function deleteAgent() {
    if (!state.currentAgentId) return;
    var ok = await confirmAction({
      title: 'Delete Agent',
      message: 'This will permanently delete this agent and all their data. This cannot be undone.',
      confirmLabel: 'Delete Agent'
    });
    if (!ok) return;
    try {
      await api.del('/api/agents/' + state.currentAgentId);
      toast('Agent deleted');
      state.currentAgentId = null;
      navigate('dashboard');
    } catch(e) {
      toast('Failed to delete agent', 'error');
    }
  }

  async function clearShortMemory() {
    if (!state.currentAgentId) return;
    var ok = await confirmAction({
      title: 'Clear Short Memory',
      message: 'This will erase all short-term memory for this agent. This cannot be undone.',
      confirmLabel: 'Clear Memory'
    });
    if (!ok) return;
    try {
      await api.put('/api/agents/' + state.currentAgentId + '/memory/short', { content: '' });
      document.getElementById('agent-detail-short-mem').textContent = 'Empty';
      toast('Short memory cleared');
    } catch(e) { toast('Failed to clear memory', 'error'); }
  }

  function toggleMemoryEdit(type) {
    var editor = document.getElementById(type + '-mem-editor');
    var display = document.getElementById('agent-detail-' + type + '-mem');
    var textarea = document.getElementById(type + '-mem-textarea');
    var isHidden = editor.classList.contains('hidden');
    if (isHidden) {
      textarea.value = display.textContent === 'Empty' ? '' : display.textContent;
      editor.classList.remove('hidden');
      display.classList.add('hidden');
    } else {
      editor.classList.add('hidden');
      display.classList.remove('hidden');
    }
  }

  async function saveMemory(type) {
    if (!state.currentAgentId) return;
    var textarea = document.getElementById(type + '-mem-textarea');
    var content = textarea.value.trim();
    try {
      await api.put('/api/agents/' + state.currentAgentId + '/memory/' + type, { content: content });
      document.getElementById('agent-detail-' + type + '-mem').textContent = content || 'Empty';
      document.getElementById(type + '-mem-editor').classList.add('hidden');
      document.getElementById('agent-detail-' + type + '-mem').classList.remove('hidden');
      toast(type.charAt(0).toUpperCase() + type.slice(1) + ' memory saved');
    } catch(e) { toast('Failed to save memory', 'error'); }
  }

  // ── Templates ──────────────────────────────────────
  async function loadTemplatesForPicker(containerId) {
    try {
      state.templates = await api.get('/api/templates');
    } catch(e) { state.templates = []; }

    var container = document.getElementById(containerId);
    if (!container) return;

    var html = '<div class="template-card template-card-blank" onclick="App.selectTemplate(null, \'' + containerId + '\')"><h4>Blank</h4><p>Start from scratch</p></div>';
    html += state.templates.map(function(t) {
      return '<div class="template-card" data-template="' + t.templateId + '" onclick="App.selectTemplate(\'' + t.templateId + '\', \'' + containerId + '\')">' +
        '<h4>' + escHtml(t.name) + '</h4><p>' + escHtml(t.role) + '</p></div>';
    }).join('');
    container.innerHTML = html;
  }

  function selectTemplate(templateId, containerId) {
    var container = document.getElementById(containerId);
    container.querySelectorAll('.template-card').forEach(function(c) { c.classList.remove('selected'); });
    if (templateId) {
      var card = container.querySelector('[data-template="' + templateId + '"]');
      if (card) card.classList.add('selected');
    } else {
      container.querySelector('.template-card-blank').classList.add('selected');
    }

    if (!templateId) {
      clearAgentForm();
      return;
    }

    var tmpl = state.templates.find(function(t) { return t.templateId === templateId; });
    if (!tmpl) return;
    fillAgentForm(tmpl);
  }

  // ── Profile Editor ─────────────────────────────────
  async function loadProfileEditor() {
    try {
      var p = await api.get('/api/profile');
      document.getElementById('pf-name').value = p.name || '';
      document.getElementById('pf-role').value = p.role || '';
      document.getElementById('pf-expertise').value = p.expertise || '';
      document.getElementById('pf-goals').value = p.goals || '';
      document.getElementById('pf-audience').value = p.targetAudience || '';
      document.getElementById('pf-voice').value = p.brandVoice || '';
      document.getElementById('pf-comm-style').value = p.communicationStyle || '';
    } catch(e) { console.error('Failed to load profile:', e); }
  }

  async function saveProfile() {
    var data = {
      name: document.getElementById('pf-name').value.trim(),
      role: document.getElementById('pf-role').value.trim(),
      expertise: document.getElementById('pf-expertise').value.trim(),
      goals: document.getElementById('pf-goals').value.trim(),
      targetAudience: document.getElementById('pf-audience').value.trim(),
      brandVoice: document.getElementById('pf-voice').value.trim(),
      communicationStyle: document.getElementById('pf-comm-style').value.trim(),
    };
    try {
      await api.put('/api/profile', data);
      toast('Profile saved');
    } catch(e) { toast('Failed to save profile', 'error'); }
  }

  // ── Rules Editor ───────────────────────────────────
  async function loadRulesEditor() {
    try {
      var [team, security] = await Promise.all([
        api.get('/api/rules/team'),
        api.get('/api/rules/security'),
      ]);
      document.getElementById('rules-team').value = team.content || '';
      document.getElementById('rules-security').value = security.content || '';
    } catch(e) { console.error('Failed to load rules:', e); }
  }

  async function saveRules(type) {
    var content = document.getElementById('rules-' + type).value;
    try {
      await api.put('/api/rules/' + type, { content: content });
      toast(type.charAt(0).toUpperCase() + type.slice(1) + ' rules saved');
    } catch(e) { toast('Failed to save rules', 'error'); }
  }

  // ── Settings ───────────────────────────────────────
  function switchSettingsSection(sectionId) {
    var sections = document.querySelectorAll('.settings-section');
    for (var i = 0; i < sections.length; i++) {
      sections[i].classList.remove('active');
    }
    var items = document.querySelectorAll('.settings-sidebar-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('active');
    }
    var target = document.getElementById('settings-sec-' + sectionId);
    if (target) target.classList.add('active');
    var item = document.querySelector('.settings-sidebar-item[data-section="' + sectionId + '"]');
    if (item) item.classList.add('active');
    state.settingsSection = sectionId;
  }

  function renderVaultStatusBar(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    api.get('/api/secrets/status').then(function(status) {
      if (!status.exists) {
        container.className = 'vault-status-bar not-configured';
        container.innerHTML = '<span>&#9888; No vault configured yet</span>';
      } else if (status.locked) {
        container.className = 'vault-status-bar locked';
        container.innerHTML = '<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Vault is locked</span>';
      } else {
        container.className = 'vault-status-bar unlocked';
        container.innerHTML = '<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> Vault unlocked</span><button class="btn btn-secondary" onclick="App.lockSecrets()" style="font-size:11px;padding:3px 10px;margin-left:auto">Lock</button>';
      }
    }).catch(function() {
      container.className = 'vault-status-bar not-configured';
      container.innerHTML = '<span>Unable to check vault status</span>';
    });
  }

  async function loadSettings() {
    try {
      var sys = await api.get('/api/system/status');
      var agents = await api.get('/api/agents');
      document.getElementById('settings-team-name').textContent = sys.teamName || '-';
      document.getElementById('settings-version').textContent = 'v' + (sys.version || '1.0.0');
      document.getElementById('settings-agent-count').textContent = (agents.agents || []).length;
    } catch(e) { console.error('Failed to load settings:', e); }
    checkClaudeStatus();
    loadPermissionMode();
    loadAccessPaths();
    checkForUpdates();
    checkSystemHealth();
    loadSecretsStatus();
    loadCredentialsStatus();
    loadTempStatus();
    loadBackupList();
    renderVaultStatusBar('vault-status-bar-secrets');
    renderVaultStatusBar('vault-status-bar-passwords');
    loadNotifPrefs();
    renderModelRoutingSettings();
    // Restore last active section
    if (state.settingsSection) {
      switchSettingsSection(state.settingsSection);
    }
  }

  async function loadTempStatus() {
    try {
      var result = await api.get('/api/temp/status');
      var el = document.getElementById('temp-status');
      if (el) el.textContent = result.fileCount + ' files, ' + result.totalSizeMB + ' MB';
    } catch(e) {
      var el = document.getElementById('temp-status');
      if (el) el.textContent = '-';
    }
  }

  async function cleanupTemp() {
    if (!confirm('Delete all files in the temp workspace?')) return;
    try {
      await api.post('/api/temp/cleanup', {});
      toast('Temp folder cleaned');
      loadTempStatus();
    } catch(e) { toast('Failed to clean temp', 'error'); }
  }

  // ── Backup / Restore ──────────────────────────────
  async function createBackup() {
    var includeMedia = document.getElementById('backup-include-media')?.checked || false;
    try {
      toast('Creating backup...');
      var result = await api.post('/api/backup/create', { includeMedia: includeMedia });
      toast('Backup created (' + result.sizeMB + ' MB)');
      loadBackupList();
    } catch(e) { toast('Backup failed: ' + e.message, 'error'); }
  }

  async function loadBackupList() {
    var container = document.getElementById('backup-list');
    if (!container) return;
    try {
      var result = await api.get('/api/backup/list');
      var backups = result.backups || [];
      if (!backups.length) { container.innerHTML = '<div style="color:var(--text-muted);font-size:12px">No backups yet</div>'; return; }
      var html = '';
      for (var i = 0; i < backups.length; i++) {
        var b = backups[i];
        var date = b.manifest?.timestamp ? new Date(b.manifest.timestamp).toLocaleString() : b.id;
        var media = b.manifest?.includeMedia ? ' (with media)' : '';
        html += '<div class="backup-item">'
          + '<div class="backup-info"><span class="backup-date">' + date + '</span>'
          + '<span class="backup-meta">' + b.sizeMB + ' MB' + media + '</span></div>'
          + '<div class="backup-actions">'
          + '<button class="btn btn-secondary" onclick="App.restoreBackup(\'' + b.id + '\')">Restore</button>'
          + '<button class="btn btn-cancel" onclick="App.deleteBackup(\'' + b.id + '\')">Delete</button>'
          + '</div></div>';
      }
      container.innerHTML = html;
    } catch(e) { container.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Failed to load backups</div>'; }
  }

  async function restoreBackup(backupId) {
    var confirmed = prompt('This will overwrite current data. Type "restore" to confirm:');
    if (confirmed !== 'restore') { toast('Restore cancelled'); return; }
    try {
      toast('Restoring backup...');
      await api.post('/api/backup/restore', { backupId: backupId });
      toast('Backup restored successfully');
    } catch(e) { toast('Restore failed: ' + e.message, 'error'); }
  }

  async function deleteBackup(backupId) {
    if (!confirm('Delete this backup?')) return;
    try {
      await api.post('/api/backup/delete', { backupId: backupId });
      toast('Backup deleted');
      loadBackupList();
    } catch(e) { toast('Delete failed: ' + e.message, 'error'); }
  }

  async function rebuildContext() {
    try {
      await api.post('/api/rebuild-context', {});
      toast('CLAUDE.md rebuilt');
    } catch(e) { toast('Failed to rebuild context', 'error'); }
  }

  async function shutdownServer() {
    var ok = await confirmAction({
      title: 'Close Session',
      message: 'This will stop the portal server and close the CLI session. You will need to run launch.bat again to restart.',
      confirmLabel: 'Close Session'
    });
    if (!ok) return;
    try {
      await api.post('/api/server/shutdown', {});
    } catch(e) { /* expected - server is shutting down */ }
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#999;font-size:18px;">Session closed. You can close this tab.</div>';
  }

  async function restartServer() {
    var ok = await confirmAction({
      title: 'Restart Server',
      message: 'This will restart the portal server and CLI session. The page will automatically reconnect.',
      confirmLabel: 'Restart'
    });
    if (!ok) return;
    try {
      await api.post('/api/server/restart', {});
    } catch(e) { /* expected - server is restarting */ }
    toast('Server restarting...');
    // Wait and reload
    setTimeout(function() { location.reload(); }, 4000);
  }

  function runHealthCheck() {
    if (!termWs || termWs.readyState !== 1) {
      toast('Terminal not connected - open the Command Center first', 'warning');
      return;
    }
    var msg = 'A system health check was requested. Call GET /api/health to verify all system components. Check for any failures or warnings and report results. If any issues are found, attempt to fix them by rebuilding context (POST /api/rebuild-context). Report the final status.\r';
    termWs.send(JSON.stringify({ type: 'input', data: msg }));
    toast('Health check sent to CLI');
    // Switch to command center so user can see the output
    navigate('command-center');
  }

  async function resetSystem() {
    var ok = await confirmAction({
      title: 'Reset Entire System',
      message: 'This will reset the system to its initial state. You will see the setup wizard on next load. This is a destructive action.',
      confirmLabel: 'Reset System',
      requireText: 'reset'
    });
    if (!ok) return;
    try {
      await api.post('/api/write-file', { path: 'config/system.json', content: JSON.stringify({ initialized: false, teamName: '', teamDescription: '', version: '1.0.0' }, null, 2) });
      toast('System reset. Reload the page to see the wizard.');
    } catch(e) { toast('Failed to reset', 'error'); }
  }

  async function resetAgents() {
    var ok = await confirmAction({
      title: 'Delete All Sub-Agents',
      message: 'This will permanently delete ALL sub-agents. Only the orchestrator will remain. This cannot be undone.',
      confirmLabel: 'Delete All Agents',
      requireText: 'reset'
    });
    if (!ok) return;
    try {
      await api.post('/api/agents/reset', {});
      await loadSidebarAgents();
      toast('All sub-agents deleted. Orchestrator remains.');
      if (state.currentView === 'agent-detail') navigate('dashboard');
    } catch(e) { toast('Failed to reset agents', 'error'); }
  }

  // ── Permission Mode ─────────────────────────────────
  var permModeDescs = {
    autonomous: 'Claude works independently with full tool access. Best for unattended work. Safety boundaries in CLAUDE.md still apply.',
    supervised: 'Claude asks for permission before using each tool. Best when you want manual control over every action.',
  };

  async function loadPermissionMode() {
    var select = document.getElementById('permission-mode-select');
    var desc = document.getElementById('permission-mode-desc');
    if (!select) return;
    try {
      var result = await api.get('/api/settings/permission-mode');
      select.value = result.mode || 'autonomous';
      if (desc) desc.textContent = permModeDescs[select.value] || '';
    } catch(e) {
      select.value = 'autonomous';
      if (desc) desc.textContent = permModeDescs.autonomous;
    }
  }

  async function savePermissionMode() {
    var select = document.getElementById('permission-mode-select');
    var desc = document.getElementById('permission-mode-desc');
    if (!select) return;
    var mode = select.value;
    if (desc) desc.textContent = permModeDescs[mode] || '';
    try {
      await api.put('/api/settings/permission-mode', { mode: mode });
      toast('Permission mode set to ' + mode + '. Restart terminal sessions to apply.');
    } catch(e) { toast('Failed to save permission mode', 'error'); }
  }

  // ── Local Access Paths ──────────────────────────────
  async function loadAccessPaths() {
    var container = document.getElementById('access-paths-list');
    if (!container) return;
    try {
      var result = await api.get('/api/settings/access-paths');
      var paths = result.paths || [];
      var root = result.root || '';
      container.innerHTML = paths.map(function(p) {
        var isDefault = (p === root);
        return '<div class="access-path-item">' +
          '<div class="access-path-info">' +
            '<span class="access-path-text">' + escHtml(p) + '</span>' +
            '<span class="access-path-hint">includes subfolders</span>' +
          '</div>' +
          (isDefault
            ? '<span class="access-path-default">Default</span>'
            : '<button class="access-path-remove" onclick="App.removeAccessPath(\'' + escHtml(p.replace(/'/g, "\\'")) + '\')" title="Remove">&times;</button>') +
        '</div>';
      }).join('');
    } catch(e) {
      container.innerHTML = '<div class="form-hint">Failed to load access paths</div>';
    }
  }

  async function addAccessPath() {
    var input = document.getElementById('access-path-input');
    if (!input) return;
    var p = input.value.trim();
    if (!p) { toast('Enter a folder path', 'error'); return; }
    try {
      await api.post('/api/settings/access-paths', { path: p });
      input.value = '';
      toast('Access path added');
      loadAccessPaths();
    } catch(e) { toast('Failed to add path: ' + e.message, 'error'); }
  }

  async function removeAccessPath(p) {
    if (!confirm('Remove access to ' + p + '?')) return;
    try {
      await fetch('/api/settings/access-paths', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p })
      }).then(function(res) { return res.json(); });
      toast('Access path removed');
      loadAccessPaths();
    } catch(e) { toast('Failed to remove path', 'error'); }
  }

  // ── Secrets Management ──────────────────────────────
  async function loadSecretsStatus() {
    var badge = document.getElementById('secrets-status-badge');
    var unlockForm = document.getElementById('secrets-unlock-form');
    var setupForm = document.getElementById('secrets-setup-form');
    var listContainer = document.getElementById('secrets-list-container');
    var addForm = document.getElementById('secrets-add-form');
    if (!badge) return;

    // Hide all forms
    if (unlockForm) unlockForm.classList.add('hidden');
    if (setupForm) setupForm.classList.add('hidden');
    if (listContainer) listContainer.classList.add('hidden');
    if (addForm) addForm.classList.add('hidden');

    try {
      var status = await api.get('/api/secrets/status');
      if (!status.exists) {
        badge.textContent = 'Not configured';
        badge.className = 'badge badge-inactive';
        if (setupForm) setupForm.classList.remove('hidden');
      } else if (status.locked) {
        badge.textContent = 'Locked';
        badge.className = 'badge badge-pending';
        if (unlockForm) unlockForm.classList.remove('hidden');
      } else {
        badge.textContent = 'Unlocked (' + status.count + ' secret' + (status.count !== 1 ? 's' : '') + ')';
        badge.className = 'badge badge-active';
        if (listContainer) listContainer.classList.remove('hidden');
        loadSecretsList();
      }
    } catch(e) {
      badge.textContent = 'Error';
      badge.className = 'badge badge-inactive';
    }
  }

  async function loadSecretsList() {
    var listEl = document.getElementById('secrets-list');
    if (!listEl) return;
    try {
      var data = await api.get('/api/secrets');
      if (!data.secrets || data.secrets.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No secrets stored</div>';
        return;
      }
      listEl.innerHTML = data.secrets.map(function(s) {
        return '<div class="secret-item">' +
          '<span class="secret-name">' + escHtml(s.name) + '</span>' +
          '<span class="secret-value">' + escHtml(s.maskedValue) + '</span>' +
          '<span class="secret-actions">' +
            '<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" onclick="App.editSecret(' + q + s.name + q + ')">Edit</button>' +
            '<button class="btn btn-cancel" style="font-size:11px;padding:3px 8px" onclick="App.deleteSecret(' + q + s.name + q + ')">Delete</button>' +
          '</span>' +
        '</div>';
      }).join('');
    } catch(e) {
      listEl.innerHTML = '<div class="empty-state">Failed to load secrets</div>';
    }
  }

  async function unlockSecrets() {
    var pw = document.getElementById('secrets-master-password');
    if (!pw || !pw.value) { toast('Enter the master password', 'error'); return; }
    try {
      await api.post('/api/secrets/unlock', { password: pw.value });
      pw.value = '';
      toast('Secrets unlocked');
      loadSecretsStatus();
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) {
      toast('Invalid master password', 'error');
    }
  }

  async function lockSecrets() {
    try {
      await api.post('/api/secrets/lock', {});
      toast('Secrets locked');
      loadSecretsStatus();
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) { toast('Failed to lock secrets', 'error'); }
  }

  async function initializeSecrets() {
    var pw = document.getElementById('secrets-new-master-password');
    var confirm = document.getElementById('secrets-confirm-master-password');
    if (!pw || !pw.value) { toast('Enter a master password', 'error'); return; }
    if (pw.value !== confirm.value) { toast('Passwords do not match', 'error'); return; }
    if (pw.value.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
    try {
      await api.post('/api/secrets/init', { password: pw.value });
      pw.value = ''; confirm.value = '';
      toast('Vault created!');
      loadSecretsStatus();
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) { toast(e.message || 'Failed to create vault', 'error'); }
  }

  function showAddSecret() {
    var addForm = document.getElementById('secrets-add-form');
    if (addForm) addForm.classList.remove('hidden');
    document.getElementById('secret-add-name').value = '';
    document.getElementById('secret-add-value').value = '';
  }

  function cancelAddSecret() {
    document.getElementById('secrets-add-form').classList.add('hidden');
  }

  async function saveSecret() {
    var nameEl = document.getElementById('secret-add-name');
    var valueEl = document.getElementById('secret-add-value');
    var name = nameEl.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    var value = valueEl.value;
    if (!name || !value) { toast('Name and value are required', 'error'); return; }

    try {
      await api.post('/api/secrets', { name: name, value: value });
      toast('Secret saved');
      document.getElementById('secrets-add-form').classList.add('hidden');
      loadSecretsStatus();
    } catch(e) { toast(e.message || 'Failed to save secret', 'error'); }
  }

  async function editSecret(name) {
    var nameEl = document.getElementById('secret-add-name');
    var valueEl = document.getElementById('secret-add-value');
    nameEl.value = name;
    valueEl.value = '';
    valueEl.placeholder = 'Enter new value';
    document.getElementById('secrets-add-form').classList.remove('hidden');
  }

  async function deleteSecret(name) {
    if (!confirm('Delete secret "' + name + '"? This cannot be undone.')) return;
    try {
      await api.del('/api/secrets/' + encodeURIComponent(name));
      toast('Secret deleted');
      loadSecretsStatus();
    } catch(e) { toast('Failed to delete secret', 'error'); }
  }

  async function changeSecretsPassword() {
    var current = prompt('Enter current master password:');
    if (!current) return;
    var newPw = prompt('Enter new master password:');
    if (!newPw) return;
    var confirmPw = prompt('Confirm new password:');
    if (newPw !== confirmPw) { toast('Passwords do not match', 'error'); return; }
    try {
      await api.post('/api/secrets/change-password', { currentPassword: current, newPassword: newPw });
      toast('Master password changed');
    } catch(e) { toast('Failed to change password. Check current password.', 'error'); }
  }

  // ── Credentials Manager ──────────────────────────────
  var credentialsVaultPassword = null;

  async function loadCredentialsStatus() {
    var lockedMsg = document.getElementById('credentials-locked-msg');
    var setupForm = document.getElementById('credentials-setup-form');
    var listContainer = document.getElementById('credentials-list-container');
    var addForm = document.getElementById('credentials-add-form');
    if (!lockedMsg) return;

    lockedMsg.classList.add('hidden');
    if (setupForm) setupForm.classList.add('hidden');
    if (listContainer) listContainer.classList.add('hidden');
    if (addForm) addForm.classList.add('hidden');

    try {
      var status = await api.get('/api/secrets/status');
      if (!status.exists) {
        // No vault at all - show setup form
        if (setupForm) setupForm.classList.remove('hidden');
      } else if (status.locked) {
        // Vault exists but locked
        lockedMsg.classList.remove('hidden');
      } else {
        // Vault unlocked
        if (listContainer) listContainer.classList.remove('hidden');
        loadCredentialsList();
      }
    } catch(e) {
      lockedMsg.classList.remove('hidden');
    }
  }

  async function initializeCredentialsVault() {
    var pw = document.getElementById('credentials-new-master-password');
    var confirmPw = document.getElementById('credentials-confirm-master-password');
    if (!pw || !pw.value) { toast('Enter a master password', 'error'); return; }
    if (pw.value !== confirmPw.value) { toast('Passwords do not match', 'error'); return; }
    if (pw.value.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
    try {
      await api.post('/api/secrets/init', { password: pw.value });
      pw.value = ''; confirmPw.value = '';
      toast('Vault created!');
      loadSecretsStatus();
      loadCredentialsStatus();
      renderVaultStatusBar('vault-status-bar-secrets');
      renderVaultStatusBar('vault-status-bar-passwords');
    } catch(e) { toast(e.message || 'Failed to create vault', 'error'); }
  }

  async function loadCredentialsList() {
    var listEl = document.getElementById('credentials-list');
    if (!listEl) return;
    try {
      var data = await api.get('/api/credentials');
      if (!data.credentials || data.credentials.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No credentials stored</div>';
        return;
      }
      listEl.innerHTML = data.credentials.map(function(c) {
        return '<div class="secret-item">' +
          '<span class="secret-name">' + escHtml(c.service) + '</span>' +
          '<span class="secret-value">' + escHtml(c.username) + ' / ' + escHtml(c.maskedPassword) + '</span>' +
          '<span class="secret-actions">' +
            '<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" onclick="App.editCredential(' + q + c.service + q + ')">Edit</button>' +
            '<button class="btn btn-cancel" style="font-size:11px;padding:3px 8px" onclick="App.deleteCredential(' + q + c.service + q + ')">Delete</button>' +
          '</span>' +
        '</div>';
      }).join('');
    } catch(e) {
      listEl.innerHTML = '<div class="empty-state">Failed to load credentials</div>';
    }
  }

  var editingCredentialService = null;

  function showAddCredential() {
    editingCredentialService = null;
    var addForm = document.getElementById('credentials-add-form');
    if (addForm) addForm.classList.remove('hidden');
    document.getElementById('credential-add-service').value = '';
    document.getElementById('credential-add-service').disabled = false;
    document.getElementById('credential-add-username').value = '';
    document.getElementById('credential-add-password').value = '';
  }

  function cancelAddCredential() {
    document.getElementById('credentials-add-form').classList.add('hidden');
    editingCredentialService = null;
  }

  async function saveCredential() {
    var serviceEl = document.getElementById('credential-add-service');
    var usernameEl = document.getElementById('credential-add-username');
    var passwordEl = document.getElementById('credential-add-password');
    var service = serviceEl.value.trim();
    var username = usernameEl.value.trim();
    var password = passwordEl.value;
    if (!service || !username || !password) { toast('All fields are required', 'error'); return; }

    try {
      if (editingCredentialService) {
        await api.put('/api/credentials/' + encodeURIComponent(editingCredentialService), { username: username, password: password });
        toast('Credential updated');
      } else {
        var body = { service: service, username: username, password: password };
        if (credentialsVaultPassword) {
          body.masterPassword = credentialsVaultPassword;
          credentialsVaultPassword = null;
        }
        await api.post('/api/credentials', body);
        toast('Credential saved');
      }
      document.getElementById('credentials-add-form').classList.add('hidden');
      editingCredentialService = null;
      loadCredentialsList();
      loadSecretsStatus(); // refresh secrets panel too since vault was created
    } catch(e) { toast(e.message || 'Failed to save credential', 'error'); }
  }

  function editCredential(service) {
    editingCredentialService = service;
    var serviceEl = document.getElementById('credential-add-service');
    serviceEl.value = service;
    serviceEl.disabled = true;
    document.getElementById('credential-add-username').value = '';
    document.getElementById('credential-add-password').value = '';
    document.getElementById('credential-add-username').placeholder = 'Enter new username';
    document.getElementById('credential-add-password').placeholder = 'Enter new password';
    document.getElementById('credentials-add-form').classList.remove('hidden');
  }

  async function deleteCredential(service) {
    if (!confirm('Delete credential for "' + service + '"? This cannot be undone.')) return;
    try {
      await api.del('/api/credentials/' + encodeURIComponent(service));
      toast('Credential deleted');
      loadCredentialsList();
    } catch(e) { toast('Failed to delete credential', 'error'); }
  }

