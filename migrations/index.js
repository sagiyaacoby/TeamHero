// Migration Registry - ordered list of all migrations
// Each entry: { version, name, run: function(ctx) }
// Migrations run sequentially when upgrading between versions

module.exports = [
  { version: '2.5.0', name: 'add-blocker-field', run: require('./2.5.0-add-blocker-field') },
  { version: '2.6.0', name: 'add-autopilot-memory', run: require('./2.6.0-add-autopilot-memory') },
  { version: '2.6.2', name: 'add-tags-timestamps', run: require('./2.6.2-add-tags-timestamps') },
  { version: '2.6.4', name: 'structured-agent-memory', run: require('./2.6.4-structured-agent-memory') },
  { version: '2.7.0', name: 'normalize-statuses', run: require('./2.7.0-normalize-statuses') },
  { version: '2.8.1', name: 'autopilot-tasks', run: require('./2.8.1-autopilot-tasks') },
  { version: '2.8.2', name: 'backfill-subtask-links', run: require('./2.8.2-backfill-subtask-links') },
  { version: '2.8.4', name: 'agent-os-layer', run: require('./2.8.4-agent-os-layer') },
];
