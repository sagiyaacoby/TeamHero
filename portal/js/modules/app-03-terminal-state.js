  // ── Terminal State ──────────────────────────────────
  var terminal = null;
  var fitAddon = null;
  var termWs = null;
  var termSessionId = null;
  var termInitialized = false;
  var termWsReconnectTimer = null;
  var termSessionEnded = false;

  function connectWebSocket() {
    if (globalWs && globalWs.readyState <= 1) return;

    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.host + '/ws';
    globalWs = new WebSocket(wsUrl);

    globalWs.onopen = function() {
      clearTimeout(wsReconnectTimer);
      // Refresh sidebar agents on reconnect to reset stale indicator state
      loadSidebarAgents();
    };

    globalWs.onmessage = function(evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'refresh') {
          handleRefresh(data.scope);
        } else if (data.type === 'agent-activity') {
          // Update agent activity state in sidebar
          if (data.agentId) {
            var agentInState = state.agents.find(function(a) { return a.id === data.agentId; });
            if (agentInState) agentInState.active = data.active;
            renderSidebarAgents();
          }
        } else if (data.type === 'event' && data.event) {
          addNotification(data.event, data.data || {});
        }
      } catch(e) {
        console.error('WS parse error:', e);
      }
    };

    globalWs.onclose = function(evt) {
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    globalWs.onerror = function(evt) {
    };
  }

