  // ── Terminal / Command Center ──────────────────────
  function setChatStatus(status) {
    var el = document.getElementById('chat-status');
    if (!el) return;
    el.className = 'chat-status ' + status;
    el.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
  }

  function initTerminal() {
    if (termInitialized && terminal) {
      // Already initialized, just re-fit
      if (fitAddon) setTimeout(function() { try { fitAddon.fit(); } catch(e) {} }, 50);
      // Reconnect WS if it died while on another tab
      if (!termWs || termWs.readyState > 1) {
        connectTerminalWs();
      }
      return;
    }

    var container = document.getElementById('terminal-container');
    if (!container) return;

    // Check if xterm.js loaded
    if (typeof Terminal === 'undefined') {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Terminal library failed to load. Check your internet connection and reload.</div>';
      return;
    }

    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88,166,255,0.3)',
        black: '#0d1117',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#76e3ea',
        white: '#e6edf3',
        brightBlack: '#8b949e',
        brightRed: '#f85149',
        brightGreen: '#3fb950',
        brightYellow: '#d29922',
        brightBlue: '#58a6ff',
        brightMagenta: '#bc8cff',
        brightCyan: '#76e3ea',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    if (typeof WebLinksAddon !== 'undefined') {
      terminal.loadAddon(new WebLinksAddon.WebLinksAddon());
    }

    terminal.open(container);
    fitAddon.fit();

    // Handle copy (Ctrl+C with selection) and paste (Ctrl+V)
    terminal.attachCustomKeyEventHandler(function(ev) {
      if (ev.type === 'keydown' && ev.ctrlKey && ev.key === 'c' && terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection()).catch(function() {});
        return false;
      }
      if (ev.type === 'keydown' && ev.ctrlKey && ev.key === 'v') {
        ev.preventDefault();
        navigator.clipboard.readText().then(function(text) {
          if (text && termWs && termWs.readyState === 1) {
            termWs.send(JSON.stringify({ type: 'input', data: text }));
          }
        }).catch(function() {});
        return false;
      }
      return true;
    });

    // Handle user input -> send to server
    terminal.onData(function(data) {
      if (termWs && termWs.readyState === 1) {
        termWs.send(JSON.stringify({ type: 'input', data: data }));
      }
    });

    // Handle resize
    terminal.onResize(function(size) {
      if (termWs && termWs.readyState === 1) {
        termWs.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });

    // Re-fit on window resize
    window.addEventListener('resize', function() {
      if (fitAddon && state.currentView === 'chat') {
        try { fitAddon.fit(); } catch(e) {}
      }
    });

    termInitialized = true;
    connectTerminalWs();
  }

  function connectTerminalWs() {
    // Clear any pending reconnect
    if (termWsReconnectTimer) { clearTimeout(termWsReconnectTimer); termWsReconnectTimer = null; }

    // Reuse session ID from sessionStorage for tab persistence
    termSessionId = sessionStorage.getItem('termSessionId') || '';

    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.host + '/ws/terminal';
    if (termSessionId) wsUrl += '?session=' + encodeURIComponent(termSessionId);

    if (termWs) {
      try { termWs.close(); } catch(e) {}
    }

    termSessionEnded = false;
    termWs = new WebSocket(wsUrl);

    termWs.onopen = function() {
      setChatStatus('connected');
      // Send initial resize
      if (terminal && fitAddon) {
        try { fitAddon.fit(); } catch(e) {}
        termWs.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
    };

    termWs.onmessage = function(evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'terminal-output' && terminal) {
          terminal.write(data.data);
          // Intercept RC output for Remote Control feature
          if (rcState.listening || rcState.active) {
            parseRcOutput(data.data);
          }
        } else if (data.type === 'terminal-ready') {
          termSessionId = data.session;
          sessionStorage.setItem('termSessionId', termSessionId);
          termSessionEnded = false;
        } else if (data.type === 'terminal-exit') {
          termSessionEnded = true;
          if (terminal) {
            terminal.write('\r\n\x1b[33m[Session ended. Click Restart to start a new session.]\x1b[0m\r\n');
          }
        } else if (data.type === 'terminal-error') {
          if (terminal) {
            terminal.write('\r\n\x1b[31m' + data.error + '\x1b[0m\r\n');
          }
        }
      } catch(e) {
        console.error('Terminal WS parse error:', e);
      }
    };

    termWs.onclose = function() {
      setChatStatus('disconnected');
      // Auto-reconnect after 3s unless the session intentionally ended
      if (!termSessionEnded) {
        termWsReconnectTimer = setTimeout(function() {
          if (termInitialized && (!termWs || termWs.readyState > 1)) {
            connectTerminalWs();
          }
        }, 3000);
      }
    };

    termWs.onerror = function() {
      setChatStatus('disconnected');
    };
  }

  function restartTerminal() {
    termSessionEnded = false;
    if (termWs && termWs.readyState === 1) {
      termWs.send(JSON.stringify({ type: 'restart' }));
      if (terminal) terminal.clear();
    } else {
      // Reconnect fresh
      sessionStorage.removeItem('termSessionId');
      termSessionId = '';
      if (terminal) terminal.clear();
      connectTerminalWs();
    }
  }

  // ── Remote Control ────────────────────────────────
  var rcState = { active: false, url: '', listening: false };

  function openRemoteControl() {
    document.getElementById('remote-control-modal').classList.remove('hidden');
    if (rcState.active && rcState.url) {
      updateRcModal('active');
    }
  }

  function closeRemoteControl() {
    document.getElementById('remote-control-modal').classList.add('hidden');
  }

  function startRemoteControl() {
    if (!termWs || termWs.readyState !== 1) {
      toast('Terminal not connected - open the Command Center first', 'warning');
      return;
    }
    if (termSessionEnded) {
      toast('CLI session ended - restart it first', 'warning');
      return;
    }
    rcState.listening = true;
    rcState.url = '';
    updateRcModal('generating');
    termWs.send(JSON.stringify({ type: 'input', data: '/rc\r' }));
    rcState._timeout = setTimeout(function() {
      if (rcState.listening && !rcState.active) {
        rcState.listening = false;
        updateRcModal('inactive');
        toast('Remote control timed out - check the terminal output', 'warning');
      }
    }, 30000);
  }

  function stopRemoteControl() {
    if (termWs && termWs.readyState === 1) {
      termWs.send(JSON.stringify({ type: 'input', data: '\x03' }));
    }
    rcState.active = false;
    rcState.url = '';
    rcState.listening = false;
    if (rcState._timeout) { clearTimeout(rcState._timeout); rcState._timeout = null; }
    updateRcModal('inactive');
    var btn = document.getElementById('btn-remote-control');
    if (btn) btn.classList.remove('rc-active');
  }

  function parseRcOutput(rawData) {
    var clean = rawData.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    var urlMatch = clean.match(/https:\/\/[^\s\x00-\x1f]+/);
    if (urlMatch && !rcState.active) {
      var url = urlMatch[0].replace(/[\s\r\n]+$/, '');
      if (url.indexOf('claude') !== -1 || url.indexOf('anthropic') !== -1 || url.indexOf('remote') !== -1) {
        rcState.url = url;
        rcState.active = true;
        rcState.listening = false;
        if (rcState._timeout) { clearTimeout(rcState._timeout); rcState._timeout = null; }
        updateRcModal('active');
        var btn = document.getElementById('btn-remote-control');
        if (btn) btn.classList.add('rc-active');
      }
    }
    var lower = clean.toLowerCase();
    if (rcState.active && (lower.indexOf('remote control stopped') !== -1 || lower.indexOf('remote control disconnected') !== -1 || lower.indexOf('session ended') !== -1)) {
      rcState.active = false;
      rcState.url = '';
      rcState.listening = false;
      updateRcModal('inactive');
      var btn2 = document.getElementById('btn-remote-control');
      if (btn2) btn2.classList.remove('rc-active');
    }
  }

  function updateRcModal(status) {
    var dot = document.querySelector('#rc-status .rc-status-dot');
    var text = document.getElementById('rc-status-text');
    var urlArea = document.getElementById('rc-url-area');
    var qrArea = document.getElementById('rc-qr-area');
    var startBtn = document.getElementById('rc-start-btn');
    var stopBtn = document.getElementById('rc-stop-btn');
    var urlInput = document.getElementById('rc-url-input');
    if (!dot || !text) return;
    dot.className = 'rc-status-dot';
    if (status === 'generating') {
      dot.classList.add('rc-status-generating');
      text.textContent = 'Starting...';
      urlArea.classList.add('hidden');
      qrArea.classList.add('hidden');
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
    } else if (status === 'active') {
      dot.classList.add('rc-status-active');
      text.textContent = 'Connected';
      urlInput.value = rcState.url;
      urlArea.classList.remove('hidden');
      qrArea.classList.remove('hidden');
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      renderRcQr(rcState.url);
    } else {
      dot.classList.add('rc-status-inactive');
      text.textContent = 'Inactive';
      urlArea.classList.add('hidden');
      qrArea.classList.add('hidden');
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
    }
  }

  function renderRcQr(url) {
    var container = document.getElementById('rc-qr-code');
    if (!container) return;
    try {
      if (typeof qrcode === 'function') {
        var qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        container.innerHTML = qr.createSvgTag(5, 0);
      } else {
        container.innerHTML = '<p style="font-size:11px;color:#666;word-break:break-all;">' + url + '</p>';
      }
    } catch(e) {
      container.innerHTML = '<p style="font-size:11px;color:#666;">QR generation failed</p>';
    }
  }

  function copyRcUrl() {
    if (!rcState.url) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(rcState.url).then(function() {
        toast('URL copied to clipboard');
      }).catch(function() {
        var input = document.getElementById('rc-url-input');
        if (input) { input.select(); toast('Select and copy the URL'); }
      });
    } else {
      var input = document.getElementById('rc-url-input');
      if (input) { input.select(); toast('Select and copy the URL'); }
    }
  }

