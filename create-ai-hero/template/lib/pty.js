// ── PTY Terminal Session Manager ─────────────────────────
// Extracted from server.js - zero behavior change

var pty;
try { pty = require('node-pty'); }
catch(e) { try { pty = require('node-pty-prebuilt-multiarch'); } catch(e2) { pty = null; } }

var termSessions = new Map();
var MAX_BUFFER = 50 * 1024; // 50KB rolling buffer for reconnect replay

/**
 * Create a new PTY terminal session
 * @param {string} sessionId
 * @param {object} socket - WebSocket raw socket
 * @param {object} ctx - { ROOT, readJSON, path, wsSend, scrubSecrets, getSecretNames, getCredentials, secretsCache, broadcast, genId }
 */
function createTermSession(sessionId, socket, ctx) {
  if (!pty) {
    ctx.wsSend(socket, { type: 'terminal-error', error: 'Terminal not available. Run `npm install` in the project directory.' });
    return null;
  }

  var isWindows = process.platform === 'win32';
  var shell = isWindows ? 'cmd.exe' : 'bash';
  var sys = ctx.readJSON(ctx.path.join(ctx.ROOT, 'config/system.json')) || {};
  var permMode = sys.claudePermissionMode || 'autonomous';
  var claudeCmd = permMode === 'supervised' ? 'claude' : 'claude --dangerously-skip-permissions';
  var shellArgs = isWindows ? ['/c', claudeCmd] : ['-c', claudeCmd];

  var envVars = Object.assign({}, process.env, {
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
  });
  // Inject decrypted secrets as environment variables
  if (ctx.secretsCache) {
    var skeys = ctx.getSecretNames();
    for (var si = 0; si < skeys.length; si++) { envVars[skeys[si]] = ctx.secretsCache[skeys[si]]; }
    // Inject credentials as SERVICE_USERNAME / SERVICE_PASSWORD
    var creds = ctx.getCredentials();
    for (var ci = 0; ci < creds.length; ci++) {
      var prefix = creds[ci].service.toUpperCase().replace(/[\s\-]+/g, '_').replace(/[^A-Z0-9_]/g, '');
      envVars[prefix + '_USERNAME'] = creds[ci].username;
      envVars[prefix + '_PASSWORD'] = creds[ci].password;
    }
  }

  var term = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: ctx.ROOT,
    env: envVars,
  });

  var session = {
    pty: term,
    outputBuffer: '',
    socket: socket,
    timeout: null,
  };

  term.onData(function(data) {
    // Append to rolling buffer
    session.outputBuffer += data;
    if (session.outputBuffer.length > MAX_BUFFER) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER);
    }
    // Send to connected client (scrub secrets from output)
    if (session.socket) {
      ctx.wsSend(session.socket, { type: 'terminal-output', data: ctx.scrubSecrets(data) });
    }
  });

  term.onExit(function(ev) {
    if (session.socket) {
      ctx.wsSend(session.socket, { type: 'terminal-exit', code: ev.exitCode });
    }
    termSessions.delete(sessionId);
    // Claude may have modified files via API - broadcast refresh
    ctx.broadcast('all');
    // Auto-shutdown server when terminal exits and no other sessions remain
    if (termSessions.size === 0) {
      setTimeout(function() {
        if (termSessions.size === 0) {
          console.log('Terminal exited. Shutting down server.');
          process.exit(0);
        }
      }, 3000);
    }
  });

  termSessions.set(sessionId, session);
  return session;
}

function detachTermSession(sessionId) {
  var session = termSessions.get(sessionId);
  if (!session) return;
  session.socket = null;
  // Start 5-min timeout to kill orphaned PTY
  session.timeout = setTimeout(function() {
    var s = termSessions.get(sessionId);
    if (s && !s.socket) {
      try { s.pty.kill(); } catch(e) {}
      termSessions.delete(sessionId);
    }
  }, 5 * 60 * 1000);
}

function reattachTermSession(sessionId, socket, ctx) {
  var session = termSessions.get(sessionId);
  if (!session) return null;
  // Clear orphan timeout
  if (session.timeout) { clearTimeout(session.timeout); session.timeout = null; }
  session.socket = socket;
  // Replay buffer (scrub secrets)
  if (session.outputBuffer) {
    ctx.wsSend(socket, { type: 'terminal-output', data: ctx.scrubSecrets(session.outputBuffer) });
  }
  return session;
}

/**
 * Handle terminal WebSocket connection
 * @param {object} socket - raw TCP socket after WS handshake
 * @param {object} urlObj - parsed URL object
 * @param {object} ctx - shared context
 */
function handleTerminalWs(socket, urlObj, ctx) {
  var sessionId = urlObj.searchParams.get('session') || ctx.genId();
  var termSessionId = sessionId; // capture for closures
  var buf = Buffer.alloc(0);

  // Try to reattach or create new
  var session = termSessions.get(sessionId);
  if (session) {
    reattachTermSession(sessionId, socket, ctx);
    ctx.wsSend(socket, { type: 'terminal-ready', session: sessionId, reattached: true });
  } else {
    session = createTermSession(sessionId, socket, ctx);
    if (session) {
      ctx.wsSend(socket, { type: 'terminal-ready', session: sessionId, reattached: false });
    }
  }

  socket.on('data', function(data) {
    buf = Buffer.concat([buf, data]);
    while (buf.length > 0) {
      var frame = ctx.parseWsFrame(buf);
      if (!frame) break;
      buf = buf.slice(frame.totalLen);

      if (frame.opcode === 0x8) {
        // Detach session on close (keep PTY alive)
        detachTermSession(termSessionId);
        try {
          var closeFrame = Buffer.alloc(2);
          closeFrame[0] = 0x88; closeFrame[1] = 0;
          socket.write(closeFrame);
        } catch(e) {}
        socket.destroy();
        return;
      }

      if (frame.opcode === 0x9) {
        var pong = Buffer.alloc(2);
        pong[0] = 0x8a; pong[1] = 0;
        try { socket.write(pong); } catch(e) {}
        continue;
      }

      if (frame.opcode === 0x1) {
        try {
          var msg = JSON.parse(frame.payload.toString('utf8'));
          var s = termSessions.get(termSessionId);
          if (msg.type === 'input' && s && s.pty) {
            s.pty.write(msg.data);
          } else if (msg.type === 'resize' && s && s.pty) {
            try { s.pty.resize(msg.cols || 120, msg.rows || 30); } catch(e) {}
          } else if (msg.type === 'restart') {
            // Kill existing, create new
            if (s) { try { s.pty.kill(); } catch(e) {} termSessions.delete(termSessionId); }
            termSessionId = ctx.genId();
            var newSession = createTermSession(termSessionId, socket, ctx);
            if (newSession) {
              ctx.wsSend(socket, { type: 'terminal-ready', session: termSessionId, reattached: false });
            }
          }
        } catch(e) {}
      }
    }
  });

  socket.on('close', function() { detachTermSession(termSessionId); });
  socket.on('error', function() { detachTermSession(termSessionId); });
}

/** Get the termSessions map (for server control, autopilot, etc.) */
function getTermSessions() {
  return termSessions;
}

module.exports = {
  createTermSession,
  detachTermSession,
  reattachTermSession,
  handleTerminalWs,
  getTermSessions,
};
