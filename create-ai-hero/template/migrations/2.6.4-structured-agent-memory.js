// Migration: 2.6.4 - Ensure skills-catalog, agent capabilities, and data/skills/enabled.json
// Non-destructive: only adds if missing

module.exports = function(ctx) {
  // ── skills-catalog.json ──
  var catalogDest = ctx.path.join(ctx.ROOT, 'config/skills-catalog.json');
  if (!ctx.fs.existsSync(catalogDest)) {
    // Create a minimal catalog if it doesn't exist at all
    ctx.writeJSON(catalogDest, { skills: [] });
    ctx.log('  Migration 2.6.4: created config/skills-catalog.json');
  }

  // ── data/skills/enabled.json ──
  var enabledPath = ctx.path.join(ctx.ROOT, 'data/skills/enabled.json');
  if (!ctx.fs.existsSync(enabledPath)) {
    ctx.fs.mkdirSync(ctx.path.dirname(enabledPath), { recursive: true });
    ctx.writeJSON(enabledPath, { enabled: [] });
    ctx.log('  Migration 2.6.4: created data/skills/enabled.json');
  }

  // ── Agent capabilities field ──
  var registry = ctx.readJSON(ctx.path.join(ctx.ROOT, 'agents/_registry.json'));
  if (registry && registry.agents) {
    var regChanged = false;
    registry.agents.forEach(function(a) {
      var agentPath = ctx.path.join(ctx.ROOT, 'agents', a.id, 'agent.json');
      var agent = ctx.readJSON(agentPath);
      if (!agent) return;
      if (agent.capabilities === undefined) {
        agent.capabilities = [];
        ctx.writeJSON(agentPath, agent);
      }
      // Also ensure registry entry has capabilities
      if (a.capabilities === undefined) {
        a.capabilities = [];
        regChanged = true;
      }
    });
    if (regChanged) {
      ctx.writeJSON(ctx.path.join(ctx.ROOT, 'agents/_registry.json'), registry);
    }
  }

  ctx.log('  Migration 2.6.4: skills catalog, enabled.json, and agent capabilities ensured.');
};
