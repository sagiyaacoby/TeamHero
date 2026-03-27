  // ── Init ───────────────────────────────────────────
  async function init() {
    connectWebSocket();
    loadNotificationsFromServer();

    // Voice input: show container only if Web Speech API is supported
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var voiceContainer = document.getElementById('voice-input-container');
    if (SpeechRecognition && voiceContainer) {
      voiceContainer.style.display = 'block';
    }

    // Prevent hints-bar buttons from stealing terminal focus
    var hintsBar = document.querySelector('.terminal-hints-bar');
    if (hintsBar) {
      hintsBar.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON') e.preventDefault();
      });
    }

    try {
      var sys = await api.get('/api/system/status');
      if (!sys.initialized) {
        document.getElementById('wizard-overlay').classList.remove('hidden');
        updateWizardStep();
      } else {
        updateSidebarHeader(sys.teamName);
        await loadSidebarAgents();
        loadGlobalAutopilot();
        // Deep link: navigate from hash or default to chat
        if (location.hash && location.hash !== '#') {
          _navigateFromHash();
        } else {
          navigate('chat');
        }
        // Check for updates silently on startup
        silentUpdateCheck();
        // Check post-upgrade banner and upgrading lock
        checkPostUpgradeBanner();
        // Auto-trigger health check if pending from a recent upgrade
        if (localStorage.getItem('pendingHealthCheck')) {
          localStorage.removeItem('pendingHealthCheck');
          // Navigate to command center first (initializes terminal)
          navigate('command-center');
          // Wait for terminal WebSocket to connect, then send health check
          var hcRetries = 0;
          var hcInterval = setInterval(function() {
            hcRetries++;
            if (termWs && termWs.readyState === 1) {
              clearInterval(hcInterval);
              runHealthCheck();
            } else if (hcRetries > 15) {
              clearInterval(hcInterval);
              toast('Terminal not ready - run health check manually', 'warning');
            }
          }, 1000);
        }
        // Re-check every 30 minutes
        setInterval(silentUpdateCheck, 30 * 60 * 1000);
      }
    } catch(e) {
      document.getElementById('wizard-overlay').classList.remove('hidden');
      updateWizardStep();
    }
  }

  // ── Public API ─────────────────────────────────────
