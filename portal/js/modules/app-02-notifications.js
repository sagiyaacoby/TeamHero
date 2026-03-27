  // ── Notification System ─────────────────────────────
  var notifications = [];
  var notifUnreadCount = 0;
  var notifSoundLastPlayed = 0;
  var NOTIF_SOUND_DEBOUNCE = 5000;

  function addNotification(type, data) {
    var priorityMap = { 'task.pending_approval': 'high', 'task.blocker': 'high', 'task.interrupted': 'high', 'task.done': 'medium', 'task.closed': 'low' };
    var iconMap = { 'task.pending_approval': '\u2610', 'task.blocker': '\u26A0', 'task.done': '\u2714', 'task.closed': '\u2500', 'task.interrupted': '\u26A0' };
    var textMap = {
      'task.pending_approval': (data.agentName || 'Agent') + ' submitted "' + (data.title || 'task') + '" for review',
      'task.blocker': (data.agentName || 'Agent') + ' hit a blocker on "' + (data.title || 'task') + '"',
      'task.interrupted': 'Agent ' + (data.agentName || 'unknown') + ' appears disconnected. Task "' + (data.title || 'task') + '" is stalled.',
      'task.done': (data.agentName || 'Agent') + ' completed "' + (data.title || 'task') + '"',
      'task.closed': '"' + (data.title || 'Task') + '" has been closed'
    };
    var priority = priorityMap[type] || 'low';
    var notif = {
      id: 'n-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: type,
      priority: priority,
      title: textMap[type] || type,
      detail: data.reason || '',
      taskId: data.taskId || null,
      timestamp: new Date().toISOString(),
      read: false
    };
    notifications.unshift(notif);
    if (notifications.length > 100) notifications = notifications.slice(0, 100);
    notifUnreadCount++;
    renderNotifications();
    animateBell();
    persistNotification(notif);
    if (priority === 'high') {
      sendBrowserNotification(notif);
      playNotifSound();
    }
  }

  function renderNotifications() {
    var badges = document.querySelectorAll('.notif-badge');
    var bells = document.querySelectorAll('.notif-bell');
    var list = document.getElementById('notif-list');
    for (var b = 0; b < badges.length; b++) {
      if (notifUnreadCount > 0) {
        badges[b].style.display = '';
        badges[b].textContent = notifUnreadCount > 99 ? '99+' : notifUnreadCount;
      } else {
        badges[b].style.display = 'none';
      }
    }
    for (var b = 0; b < bells.length; b++) {
      if (notifUnreadCount > 0) {
        bells[b].classList.add('has-unread');
      } else {
        bells[b].classList.remove('has-unread');
      }
    }
    if (!list) return;
    if (notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications</div>';
      return;
    }
    var iconMap = { 'task.pending_approval': '\u2610', 'task.blocker': '\u26A0', 'task.done': '\u2714', 'task.closed': '\u2500', 'task.interrupted': '\u26A0' };
    var statusColorMap = { 'task.blocker': 'notif-status-blocker', 'task.done': 'notif-status-done', 'task.pending_approval': 'notif-status-pending', 'task.closed': 'notif-status-closed', 'task.interrupted': 'notif-status-interrupted' };
    var html = '';
    for (var i = 0; i < notifications.length; i++) {
      var n = notifications[i];
      var statusClass = statusColorMap[n.type] || 'notif-status-default';
      html += '<div class="notif-item ' + (n.read ? '' : 'unread ') + statusClass + '" data-index="' + i + '">' +
        '<span class="notif-item-icon">' + (iconMap[n.type] || '\u25CF') + '</span>' +
        '<div class="notif-item-body" onclick="App.clickNotification(' + i + ')">' +
        '<div class="notif-item-text">' + escHtml(n.title) + '</div>' +
        (n.detail ? '<div class="notif-item-text" style="color:var(--text-dim);font-size:11px">' + escHtml(n.detail) + '</div>' : '') +
        '<div class="notif-item-time">' + timeAgo(n.timestamp) + '</div>' +
        '</div>' +
        '<button class="notif-dismiss-btn" onclick="event.stopPropagation();App.dismissNotification(' + i + ')" title="Dismiss">&times;</button>' +
        '</div>';
    }
    list.innerHTML = html;
  }

  function animateBell() {
    var bells = document.querySelectorAll('.notif-bell');
    for (var i = 0; i < bells.length; i++) {
      bells[i].classList.remove('pulse');
      void bells[i].offsetWidth;
      bells[i].classList.add('pulse');
    }
  }

  function toggleNotifications(e) {
    var dd = document.getElementById('notif-dropdown');
    if (!dd) return;
    if (dd.style.display === 'none') {
      dd.style.display = 'flex';
      // Position dropdown relative to the clicked bell using fixed positioning
      var bell = e ? e.target.closest('.notif-bell') : null;
      if (!bell) {
        // Fallback: find the visible bell
        var bells = document.querySelectorAll('.notif-bell');
        for (var i = 0; i < bells.length; i++) {
          if (bells[i].offsetParent !== null) { bell = bells[i]; break; }
        }
      }
      if (bell) {
        var rect = bell.getBoundingClientRect();
        dd.style.top = (rect.bottom + 6) + 'px';
        dd.style.left = Math.max(8, rect.left) + 'px';
      }
      renderNotifications();
    } else {
      dd.style.display = 'none';
    }
  }

  function clickNotification(index) {
    if (index >= 0 && index < notifications.length) {
      var n = notifications[index];
      if (!n.read) { n.read = true; notifUnreadCount = Math.max(0, notifUnreadCount - 1); }
      renderNotifications();
      if (n.taskId) {
        document.getElementById('notif-dropdown').style.display = 'none';
        openTask(n.taskId);
      }
    }
  }

  function dismissNotification(index) {
    if (index >= 0 && index < notifications.length) {
      var n = notifications[index];
      if (!n.read) notifUnreadCount = Math.max(0, notifUnreadCount - 1);
      var nid = n.id;
      notifications.splice(index, 1);
      renderNotifications();
      fetch('/api/notifications/' + nid, { method: 'DELETE' }).catch(function() {});
    }
  }

  function clearAllNotifications() {
    notifications = [];
    notifUnreadCount = 0;
    renderNotifications();
    fetch('/api/notifications', { method: 'DELETE' }).catch(function() {});
  }

  // Browser Notifications
  function sendBrowserNotification(notif) {
    if (localStorage.getItem('teamhero-notifications-browser') === 'false') return;
    if (!document.hidden) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      var bn = new Notification('TeamHero', {
        body: notif.title,
        icon: '/favicon.ico',
        tag: 'teamhero-' + (notif.taskId || notif.id),
        requireInteraction: false
      });
      bn.onclick = function() {
        window.focus();
        if (notif.taskId) openTask(notif.taskId);
        bn.close();
      };
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }

  // Sound Alerts
  function playNotifSound() {
    if (localStorage.getItem('teamhero-notifications-sound') === 'false') return;
    var now = Date.now();
    if (now - notifSoundLastPlayed < NOTIF_SOUND_DEBOUNCE) return;
    notifSoundLastPlayed = now;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      setTimeout(function() { ctx.close(); }, 500);
    } catch(e) {}
  }

  // Settings: load notification prefs
  function loadNotifPrefs() {
    var br = document.getElementById('notif-toggle-browser');
    var snd = document.getElementById('notif-toggle-sound');
    if (br) br.checked = localStorage.getItem('teamhero-notifications-browser') !== 'false';
    if (snd) snd.checked = localStorage.getItem('teamhero-notifications-sound') !== 'false';
  }

  function saveNotifPrefs() {
    var br = document.getElementById('notif-toggle-browser');
    var snd = document.getElementById('notif-toggle-sound');
    if (br) localStorage.setItem('teamhero-notifications-browser', br.checked ? 'true' : 'false');
    if (snd) localStorage.setItem('teamhero-notifications-sound', snd.checked ? 'true' : 'false');
    if (br && br.checked && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function persistNotification(notif) {
    fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notif) }).catch(function() {});
  }

  async function loadNotificationsFromServer() {
    try {
      var stored = await api.get('/api/notifications');
      if (Array.isArray(stored) && stored.length > 0) {
        notifications = stored;
        notifUnreadCount = 0;
        for (var i = 0; i < notifications.length; i++) {
          if (!notifications[i].read) notifUnreadCount++;
        }
        renderNotifications();
      }
    } catch(e) {}
  }

