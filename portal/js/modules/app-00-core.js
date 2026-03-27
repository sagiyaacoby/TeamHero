  // ── State ──────────────────────────────────────────
  let state = {
    currentView: 'dashboard',
    currentAgentId: null,
    editingAgentId: null,
    wizardStep: 1,
    agents: [],
    tasks: [],
    templates: [],
    previousView: null,
    previousAgentId: null,
    currentTaskId: null,
    mediaFilter: 'all',
    dashboardTaskFilter: 'pending',
    agentTaskFilter: 'pending',
    cachedDashboardTasks: [],
    cachedAgentTasks: [],
    dashboardViewMode: 'hierarchy',
    agentViewMode: 'hierarchy',
    hierarchyExpanded: {},
    flowExpanded: {},
    dashboardSort: JSON.parse(localStorage.getItem('dashboardSort') || '{"new":true,"priority":false}'),
    agentSort: JSON.parse(localStorage.getItem('agentSort') || '{"new":true,"priority":false}'),
    dashboardAgentFilter: null,
    agentAgentFilter: null,
    tagsVisible: localStorage.getItem('tagsVisible') !== 'false',
    tagFilterExpanded: false,
    globalAutopilot: false,
  };

  var PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
  var q = String.fromCharCode(39);

  function timeAgo(dateString) {
    if (!dateString) return '';
    var diff = Date.now() - new Date(dateString).getTime();
    if (diff < 0) return 'just now';
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    var months = Math.floor(days / 30);
    return months + 'mo ago';
  }

  // ── API Client ─────────────────────────────────────
  const api = {
    async get(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    },
    async put(url, data) {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    },
    async post(url, data) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      var body = await res.json();
      if (!res.ok) {
        var err = new Error(body.error || 'API error: ' + res.status);
        err.body = body;
        throw err;
      }
      return body;
    },
    async del(url) {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    },
  };

  // ── Toast ──────────────────────────────────────────
  function toast(msg, type) {
    type = type || 'success';
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + type;
    clearTimeout(el._timer);
    el._timer = setTimeout(function() { el.className = 'toast hidden'; }, 3000);
  }

  // ── Confirmation Modal ─────────────────────────────
  function confirmAction(opts) {
    // opts: { title, message, confirmLabel, requireText, variant, onConfirm }
    // variant: 'neutral' hides warning icon and uses neutral button style
    return new Promise(function(resolve) {
      var overlay = document.getElementById('confirm-modal');
      var titleEl = document.getElementById('confirm-title');
      var msgEl = document.getElementById('confirm-message');
      var iconEl = document.getElementById('confirm-icon');
      var inputWrap = document.getElementById('confirm-input-wrap');
      var inputEl = document.getElementById('confirm-input');
      var hintEl = document.getElementById('confirm-hint');
      var okBtn = document.getElementById('confirm-ok-btn');
      var cancelBtn = document.getElementById('confirm-cancel-btn');

      titleEl.textContent = opts.title || 'Are you sure?';
      msgEl.textContent = opts.message || '';
      okBtn.textContent = opts.confirmLabel || 'Delete';

      // Apply variant styling
      if (opts.variant === 'neutral') {
        iconEl.classList.add('hidden');
        okBtn.className = 'btn btn-primary';
      } else {
        iconEl.classList.remove('hidden');
        okBtn.className = 'btn btn-cancel';
      }

      if (opts.requireText) {
        inputWrap.classList.remove('hidden');
        inputEl.value = '';
        hintEl.textContent = 'Type "' + opts.requireText + '" to confirm';
        okBtn.disabled = true;
      } else {
        inputWrap.classList.add('hidden');
        inputEl.value = '';
        okBtn.disabled = false;
      }

      overlay.classList.remove('hidden');
      if (opts.requireText) inputEl.focus();

      function onInput() {
        okBtn.disabled = inputEl.value.trim().toLowerCase() !== opts.requireText.toLowerCase();
      }
      function cleanup() {
        overlay.classList.add('hidden');
        inputEl.removeEventListener('input', onInput);
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function onKey(e) {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && !okBtn.disabled) onOk();
      }

      if (opts.requireText) inputEl.addEventListener('input', onInput);
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  }

