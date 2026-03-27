  // ── Software Updates ─────────────────────────────────
  async function checkForUpdates() {
    var statusEl = document.getElementById('update-status');
    var currentEl = document.getElementById('update-current-version');
    var latestEl = document.getElementById('update-latest-version');
    var releaseInfo = document.getElementById('update-release-info');
    var releaseNameEl = document.getElementById('update-release-name');
    var releaseNotesEl = document.getElementById('update-release-notes');
    var releaseUrlEl = document.getElementById('update-release-url');
    var upgradeBtn = document.getElementById('update-upgrade-btn');
    var banner = document.getElementById('update-banner');

    if (statusEl) { statusEl.textContent = 'Checking...'; statusEl.className = 'badge badge-inactive'; }
    if (releaseInfo) releaseInfo.classList.add('hidden');

    try {
      var result = await api.get('/api/updates/check');
      _upgradeCheckData = result; // cache for upgrade modal

      if (currentEl) currentEl.textContent = result.currentVersion || '-';
      if (latestEl) latestEl.textContent = result.latestVersion || '-';

      if (result.error) {
        if (statusEl) { statusEl.textContent = 'Check failed'; statusEl.className = 'badge badge-inactive'; }
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        toast(result.error, 'error');
        return;
      }

      if (result.updateAvailable) {
        if (statusEl) { statusEl.textContent = 'Update available'; statusEl.className = 'badge badge-pending'; }
        if (upgradeBtn) upgradeBtn.classList.remove('hidden');
        if (banner) banner.classList.remove('hidden');
        if (releaseInfo) {
          releaseInfo.classList.remove('hidden');
          if (releaseNameEl) releaseNameEl.textContent = result.releaseName || ('v' + result.latestVersion);
          if (releaseNotesEl) {
            releaseNotesEl.innerHTML = result.releaseNotes ? (typeof marked !== 'undefined' ? marked.parse(result.releaseNotes) : escHtml(result.releaseNotes)) : '';
          }
          if (releaseUrlEl && result.releaseUrl) { releaseUrlEl.href = result.releaseUrl; }
        }
        toast('Update available: v' + result.latestVersion);
      } else {
        if (statusEl) { statusEl.textContent = 'Up to date'; statusEl.className = 'badge badge-active'; }
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        toast('You are up to date');
      }
    } catch(e) {
      if (statusEl) { statusEl.textContent = 'Error'; statusEl.className = 'badge badge-inactive'; }
      console.error('Update check failed:', e);
    }
  }

  // Cached update check result for upgrade modal
  var _upgradeCheckData = null;

  async function performUpgrade() {
    // Open upgrade modal instead of confirm()
    try {
      var statusEl = document.getElementById('update-status');
      if (statusEl) { statusEl.textContent = 'Checking...'; statusEl.className = 'badge badge-inactive'; }

      // Fetch latest check data if not cached
      if (!_upgradeCheckData) {
        _upgradeCheckData = await api.get('/api/updates/check');
      }
      if (!_upgradeCheckData || !_upgradeCheckData.updateAvailable) {
        toast('No update available');
        return;
      }

      // Populate modal
      var fromEl = document.getElementById('upgrade-from-version');
      var toEl = document.getElementById('upgrade-to-version');
      var notesEl = document.getElementById('upgrade-release-notes');
      if (fromEl) fromEl.textContent = 'v' + (_upgradeCheckData.currentVersion || '?');
      if (toEl) toEl.textContent = 'v' + (_upgradeCheckData.latestVersion || '?');
      if (notesEl) {
        var notes = _upgradeCheckData.releaseNotes || 'No release notes available.';
        notesEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(notes) : escHtml(notes);
      }

      // Check for active tasks
      var warningEl = document.getElementById('upgrade-active-warning');
      var warningText = document.getElementById('upgrade-active-text');
      var forceCheck = document.getElementById('upgrade-force-check');
      var confirmBtn = document.getElementById('upgrade-confirm-btn');
      try {
        var tasks = await api.get('/api/tasks');
        var activeTasks = (tasks.tasks || []).filter(function(t) {
          return t.status === 'working';
        });
        if (activeTasks.length > 0) {
          if (warningEl) warningEl.classList.remove('hidden');
          if (warningText) warningText.textContent = activeTasks.length + ' task' + (activeTasks.length > 1 ? 's are' : ' is') + ' currently active. Upgrading may interrupt running agents.';
          if (forceCheck) forceCheck.checked = false;
          if (confirmBtn) confirmBtn.disabled = true;
        } else {
          if (warningEl) warningEl.classList.add('hidden');
          if (confirmBtn) confirmBtn.disabled = false;
        }
      } catch(e) {
        if (warningEl) warningEl.classList.add('hidden');
        if (confirmBtn) confirmBtn.disabled = false;
      }

      // Reset progress UI
      var progressContainer = document.getElementById('upgrade-progress-container');
      if (progressContainer) progressContainer.classList.add('hidden');
      var steps = document.querySelectorAll('.upgrade-progress-step');
      steps.forEach(function(s) { s.className = 'upgrade-progress-step'; s.querySelector('.step-icon').innerHTML = '&#9675;'; });
      var actionsEl = document.getElementById('upgrade-actions');
      if (actionsEl) actionsEl.style.display = '';

      // Show modal
      document.getElementById('upgrade-modal').classList.remove('hidden');
    } catch(e) {
      toast('Failed to prepare upgrade', 'error');
      console.error('Upgrade modal error:', e);
    }
  }

  function closeUpgradeModal() {
    document.getElementById('upgrade-modal').classList.add('hidden');
  }

  function toggleUpgradeBtn() {
    var forceCheck = document.getElementById('upgrade-force-check');
    var confirmBtn = document.getElementById('upgrade-confirm-btn');
    if (confirmBtn && forceCheck) {
      confirmBtn.disabled = !forceCheck.checked;
    }
  }

  async function confirmUpgrade() {
    var confirmBtn = document.getElementById('upgrade-confirm-btn');
    var cancelBtn = document.querySelector('#upgrade-actions .btn-secondary');
    var progressContainer = document.getElementById('upgrade-progress-container');
    var warningEl = document.getElementById('upgrade-active-warning');
    var forceCheck = document.getElementById('upgrade-force-check');
    var needsForce = warningEl && !warningEl.classList.contains('hidden');

    // Disable buttons, show progress
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Upgrading...'; }
    if (cancelBtn) cancelBtn.disabled = true;
    if (progressContainer) progressContainer.classList.remove('hidden');

    // Animate progress steps
    var stepNames = ['check', 'backup', 'download', 'migrate', 'rebuild', 'done'];
    var stepTimings = [400, 1200, 2500, 1500, 800, 0]; // ms delay before marking done
    var currentStep = 0;
    var upgradeFinished = false;
    var upgradeFailed = false;
    var upgradeError = '';

    function setStepState(name, state) {
      var el = document.querySelector('.upgrade-progress-step[data-step="' + name + '"]');
      if (!el) return;
      el.className = 'upgrade-progress-step ' + state;
      var icon = el.querySelector('.step-icon');
      if (state === 'active') icon.innerHTML = '&#9679;';
      else if (state === 'done') icon.innerHTML = '&#10003;';
      else if (state === 'error') icon.innerHTML = '&#10007;';
    }

    function advanceStep() {
      if (currentStep >= stepNames.length || upgradeFailed) return;
      if (currentStep > 0) setStepState(stepNames[currentStep - 1], 'done');
      setStepState(stepNames[currentStep], 'active');
      currentStep++;
      if (!upgradeFinished && currentStep < stepNames.length) {
        setTimeout(advanceStep, stepTimings[currentStep - 1]);
      }
    }

    advanceStep();

    // Fire the actual upgrade
    try {
      var body = needsForce ? { force: true } : {};
      var result = await api.post('/api/updates/upgrade', body);
      upgradeFinished = true;

      if (result.success) {
        // Mark all remaining steps as done
        for (var i = 0; i < stepNames.length; i++) {
          setStepState(stepNames[i], 'done');
        }
        toast('Upgrade complete! Server restarting...');
        var statusEl = document.getElementById('update-status');
        if (statusEl) { statusEl.textContent = 'Restart required'; statusEl.className = 'badge badge-pending'; }
        var upgradeBtn = document.getElementById('update-upgrade-btn');
        if (upgradeBtn) upgradeBtn.classList.add('hidden');
        var banner = document.getElementById('update-banner');
        if (banner) banner.classList.add('hidden');
        // Hide actions, show done message
        var actionsEl = document.getElementById('upgrade-actions');
        if (actionsEl) actionsEl.style.display = 'none';
        // Set flag so health check auto-triggers after reload
        localStorage.setItem('pendingHealthCheck', '1');
        // Auto-close modal, then poll for server to come back and reload
        setTimeout(function() {
          closeUpgradeModal();
          toast('Waiting for server to restart...');
          var pollInterval = setInterval(function() {
            fetch('/api/health').then(function(r) {
              if (r.ok) {
                clearInterval(pollInterval);
                location.reload();
              }
            }).catch(function() { /* server still down, keep polling */ });
          }, 2000);
        }, 2000);
      } else {
        upgradeFailed = true;
        upgradeError = result.message || 'Upgrade failed';
        // If 409 active tasks conflict
        if (result.activeTasks) {
          upgradeError = 'Blocked: ' + result.activeTasks + ' active task(s). Use force option.';
        }
        setStepState(stepNames[Math.max(0, currentStep - 1)], 'error');
        toast(upgradeError, 'error');
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Retry Upgrade'; }
        if (cancelBtn) cancelBtn.disabled = false;
      }
    } catch(e) {
      upgradeFinished = true;
      upgradeFailed = true;
      setStepState(stepNames[Math.max(0, currentStep - 1)], 'error');
      toast('Upgrade failed: ' + (e.message || 'Unknown error'), 'error');
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Retry Upgrade'; }
      if (cancelBtn) cancelBtn.disabled = false;
      console.error('Upgrade error:', e);
    }
  }

  async function silentUpdateCheck() {
    try {
      var result = await api.get('/api/updates/check');
      _upgradeCheckData = result; // cache for upgrade modal
      var banner = document.getElementById('update-banner');
      if (result.updateAvailable && banner) {
        banner.classList.remove('hidden');
      }
    } catch(e) {}
  }

  // ── Post-Upgrade Banner ────────────────────────────
  async function checkPostUpgradeBanner() {
    try {
      var status = await api.get('/api/updates/status');
      // Check upgrading lock first
      if (status.upgrading) {
        showUpgradingOverlay();
        // Poll until upgrading is done
        var pollInterval = setInterval(async function() {
          try {
            var s = await api.get('/api/updates/status');
            if (!s.upgrading) {
              clearInterval(pollInterval);
              hideUpgradingOverlay();
              checkPostUpgradeBanner();
            }
          } catch(e) {}
        }, 3000);
        return;
      }
      hideUpgradingOverlay();

      // Check for recent upgrade (within 5 minutes)
      if (status.lastUpgrade) {
        var upgradeTime = new Date(status.lastUpgrade.timestamp || status.lastUpgrade);
        var now = new Date();
        var diffMs = now - upgradeTime;
        if (diffMs < 5 * 60 * 1000) {
          var version = status.lastUpgrade.toVersion || status.lastUpgrade.version || '?';
          var migrations = status.lastUpgrade.migrationsRun || 0;
          var dismissedKey = 'upgrade-dismissed-' + version;
          if (!localStorage.getItem(dismissedKey)) {
            var textEl = document.getElementById('post-upgrade-text');
            var bannerEl = document.getElementById('post-upgrade-banner');
            if (textEl) textEl.textContent = 'Updated to v' + version + ' - ' + migrations + ' migration' + (migrations !== 1 ? 's' : '') + ' applied.';
            if (bannerEl) {
              bannerEl.classList.remove('hidden');
              bannerEl._dismissKey = dismissedKey;
            }
          }
        }
      }
    } catch(e) {
      console.error('Post-upgrade check failed:', e);
    }
  }

  function dismissUpgradeBanner() {
    var bannerEl = document.getElementById('post-upgrade-banner');
    if (bannerEl) {
      if (bannerEl._dismissKey) localStorage.setItem(bannerEl._dismissKey, '1');
      bannerEl.classList.add('hidden');
    }
  }

  // ── System Health Indicator ────────────────────────
  async function checkSystemHealth() {
    var indicator = document.getElementById('system-health-indicator');
    var details = document.getElementById('system-health-details');
    if (!indicator) return;

    try {
      var status = await api.get('/api/updates/status');

      if (status.migrationFailed) {
        indicator.innerHTML = '<span class="health-indicator health-red"><span class="health-dot"></span> Migration failed</span>';
        if (details) {
          details.className = 'health-details';
          details.innerHTML = '<div>' + escHtml(status.migrationFailed.error || 'Unknown migration error') + '</div>' +
            '<div style="margin-top:8px;display:flex;gap:8px;">' +
            '<button class="btn btn-secondary" onclick="App.retryMigrations()" style="font-size:11px;padding:3px 10px;">Retry</button>' +
            '<button class="btn btn-cancel" onclick="App.rollbackUpgrade()" style="font-size:11px;padding:3px 10px;">Rollback</button>' +
            '</div>';
        }
      } else if (status.upgrading) {
        indicator.innerHTML = '<span class="health-indicator health-yellow"><span class="health-dot"></span> Upgrade in progress or interrupted</span>';
        if (details) { details.className = 'hidden'; details.innerHTML = ''; }
      } else {
        indicator.innerHTML = '<span class="health-indicator health-green"><span class="health-dot"></span> System healthy</span>';
        if (details) { details.className = 'hidden'; details.innerHTML = ''; }
      }
    } catch(e) {
      indicator.innerHTML = '<span class="health-indicator health-yellow"><span class="health-dot"></span> Unable to check</span>';
    }
  }

  async function retryMigrations() {
    toast('Retrying migrations...');
    try {
      var result = await api.post('/api/updates/upgrade', { force: true });
      if (result.success) {
        toast('Migrations completed successfully');
        checkSystemHealth();
      } else {
        toast(result.message || 'Retry failed', 'error');
      }
    } catch(e) {
      toast('Retry failed', 'error');
    }
  }

  async function rollbackUpgrade() {
    if (!confirm('Rollback to the previous version? This will restore the backup created before the last upgrade.')) return;
    toast('Rolling back...');
    try {
      var result = await api.post('/api/updates/rollback', {});
      if (result.success) {
        toast('Rollback complete. Restart the server to apply.');
        checkSystemHealth();
      } else {
        toast(result.message || 'Rollback failed', 'error');
      }
    } catch(e) {
      toast('Rollback failed', 'error');
    }
  }

  // ── Upgrading Lock Overlay ─────────────────────────
  function showUpgradingOverlay() {
    var overlay = document.getElementById('upgrading-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function hideUpgradingOverlay() {
    var overlay = document.getElementById('upgrading-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ── Claude Account Status ─────────────────────────
  async function checkClaudeStatus() {
    var installedEl = document.getElementById('claude-installed');
    var versionEl = document.getElementById('claude-version');
    if (!installedEl || !versionEl) return;

    installedEl.textContent = 'Checking...';
    installedEl.className = 'badge badge-inactive';
    versionEl.textContent = '-';

    try {
      var result = await api.get('/api/claude/status');
      if (result.installed) {
        installedEl.textContent = 'Installed';
        installedEl.className = 'badge badge-active';
        versionEl.textContent = result.version || 'Unknown';
      } else {
        installedEl.textContent = 'Not Installed';
        installedEl.className = 'badge badge-inactive';
        versionEl.textContent = '-';
      }
    } catch(e) {
      installedEl.textContent = 'Error';
      installedEl.className = 'badge badge-inactive';
    }
  }

