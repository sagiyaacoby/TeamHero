# TeamHero Release Process Guide

Reference doc for every version release. Follow this before tagging.

---

## 1. File Classification

Every file in the repo falls into one of three categories. Know which is which before you touch anything.

### PLATFORM files (shipped in release, overwritten on upgrade)

These are the product. They get extracted from the release tarball and replace whatever the user had.

- `server.js`
- `lib/*.js` (upgrade.js, migrations.js, health.js, skills.js, pty.js, etc.)
- `portal/*` (index.html, css/, js/, assets/)
- `migrations/*`
- `package.json`, `package-lock.json`
- `launch.bat`, `launch.sh`
- `.gitignore`
- `config/agent-templates/*`
- `config/skills-catalog.json`
- `config/memory-templates.md`
- `config/release-guide.md` (this file)

### GENERATED files (rebuilt from templates + local config - NEVER ship as static)

These are assembled at runtime from templates plus the user's local data (agent registry, owner profile, team rules). They must never contain hardcoded values. The upgrade system preserves them via USER_DATA_PATHS, and they get rebuilt on server startup or after upgrade.

- `CLAUDE.md` - rebuilt by `rebuildClaudeMd()` from templates + registry + owner profile + team rules + security rules + skills
- `agents/*/agent.md` - rebuilt by `rebuildAgentMd()` from agent registry data
- `config/agent-os.md` - created by migration, contains shared agent operational rules

**Why this matters:** If you ship a generated file with hardcoded agent names, ports, or team-specific data, it will break every other user's installation. The templates must use dynamic values from the registry and config.

### USER DATA files (NEVER touched by upgrade, NEVER in git)

These belong to the user. The upgrade system skips them entirely (listed in `USER_DATA_PATHS` in `lib/upgrade.js`).

- `data/` - all task data, round tables, media, knowledge base, backups, skills
- `agents/` - agent registry, agent folders, memories, work logs
- `profile/` - owner.json, owner.md
- `config/system.json` - runtime config, version tracking, upgrade state
- `config/secrets.enc`, `config/secrets.json` - encrypted secrets vault
- `config/credentials.json`, `config/credentials.md` - stored credentials
- `config/team-rules.md` - user-customized team rules
- `config/security-rules.md` - user-customized security rules
- `config/.upgrade-pending` - transient upgrade flag
- `temp/` - scratch workspace
- `.mcp.json` - MCP tool configuration

---

## 2. Pre-Release Checklist

Run through every item. Do not skip any.

### Code hygiene
- [ ] No hardcoded ports in any platform file (search for `3796`, `localhost:3796`)
- [ ] No hardcoded URLs or system-specific paths
- [ ] No team-specific agent names (Dev, Scout, Pen, Buzz, Shipper) in templates - use dynamic generation from registry
- [ ] No owner-specific data in any shipped file (names, emails, profiles)
- [ ] Templates use placeholder variables, not literal values

### Git hygiene
- [ ] `.gitignore` audit - no user data files are tracked
- [ ] No secrets, credentials, API keys, or tokens anywhere in git history
- [ ] No `.env` files committed
- [ ] Generated files (CLAUDE.md, agents/*/agent.md) are in `.gitignore`

### Upgrade safety
- [ ] All new config files classified into the correct category above
- [ ] `USER_DATA_PATHS` in `lib/upgrade.js` updated if any new user/generated files were added
- [ ] `.gitignore` updated to match any new user data paths
- [ ] Migration script created if any data structure changed (task schema, agent schema, config format)
- [ ] Migration script tested against real data from current version

### Testing
- [ ] Version bumped in `package.json`
- [ ] Fresh install works: `git clone` + `npm install` + `node server.js` - server starts, dashboard loads, can create agents and tasks
- [ ] Upgrade from previous version works: no data loss, generated files rebuild correctly, migrations run clean
- [ ] Rollback works: `data/backups/` created, rollback restores platform files without touching user data
- [ ] Post-upgrade health check passes (check server logs on startup)

### npm templates (if changed)
- [ ] `create-teamhero/` and `create-ai-hero/` templates updated to match current platform files
- [ ] Template version bumped
- [ ] `npx create-teamhero` works end-to-end on a clean machine

---

## 3. What Goes in a Release

Everything that is a PLATFORM file:

- `server.js` - the application server
- `lib/` - all JS modules (upgrade, migrations, health, skills, pty)
- `portal/` - dashboard frontend (HTML, CSS, JS, assets)
- `migrations/` - data migration scripts (including index.js)
- `config/agent-templates/` - templates for generating agent files
- `config/skills-catalog.json` - available skills definitions
- `config/memory-templates.md` - agent memory format templates
- `config/release-guide.md` - this guide
- `package.json` and `package-lock.json`
- `launch.bat` and `launch.sh` - startup scripts
- `.gitignore`
- npm template packages (`create-teamhero/`, `create-ai-hero/`) if they exist

---

## 4. What NEVER Goes in a Release

If any of these show up in `git status` as tracked, something is wrong.

### User data
- Agent memories (`agents/*/short-memory.md`, `agents/*/long-memory.md`, `agents/*/work-log.md`)
- Agent registry (`agents/_registry.json`) and agent folders (`agents/*/`)
- Task data (`data/tasks/*`)
- Round table summaries (`data/round-tables/*`)
- Media files (`data/media/*`)
- Knowledge base (`data/knowledge/*`)
- Owner profile (`profile/owner.json`, `profile/owner.md`)
- Backups (`data/backups/`)

### Secrets and credentials
- `config/secrets.enc`, `config/secrets.json`
- `config/credentials.json`, `config/credentials.md`
- `.env` or `.env.*` files

### Generated files
- `CLAUDE.md` - rebuilt from templates on every startup
- `agents/*/agent.md` - rebuilt from registry data
- `config/agent-os.md` - created by migration, shared agent rules

### Runtime state
- `config/system.json` - tracks version, upgrade state, user settings
- `config/.upgrade-pending` - transient flag
- `.mcp.json` - local MCP configuration
- `temp/` - scratch workspace
- `node_modules/`

---

## 5. Upgrade Safety Rules

The upgrade system in `lib/upgrade.js` uses an exclude-list approach: everything in `USER_DATA_PATHS` is preserved, everything else gets overwritten from the release tarball.

### Rules

1. **USER_DATA_PATHS must be complete.** If you add a new file that users customize or that is generated from local data, add it to `USER_DATA_PATHS`. Missing an entry means user data gets overwritten on upgrade.

2. **Generated files rebuild AFTER upgrade.** The upgrade calls `rebuildClaudeMd()` after extracting files. On next server start, all generated files are rebuilt from current templates plus local config. This is why templates must be dynamic.

3. **Migrations run during upgrade.** After file extraction, `migrations/index.js` runs any pending migrations. Each migration file is named `{version}-{description}.js` and runs once. Migrations must be idempotent - safe to run again if interrupted.

4. **Backup before overwrite.** The upgrade system backs up all platform files to `data/backups/v{version}/` before extracting. Rollback restores from this backup.

5. **Health check on startup.** `lib/health.js` validates directory structure, checks for interrupted upgrades, and ensures required files exist. If something is missing, it logs warnings.

6. **Never ship locked state.** Make sure `config/system.json` is not in the release (it is in `.gitignore`). If a user's system.json gets overwritten with `upgrading: true`, they are stuck.

### Current USER_DATA_PATHS (from lib/upgrade.js)

```
data/
agents/
profile/
temp/
CLAUDE.md
.mcp.json
config/team-rules.md
config/security-rules.md
config/system.json
```

If you add new user-facing config files, add them here.

---

## 6. Common Mistakes

Real bugs from past releases and how to avoid them.

### Hardcoded port in agent-os.md
**What happened:** `config/agent-os.md` was created by a migration with `localhost:3796` hardcoded. Users running on different ports got broken agent instructions.
**Fix:** Generated files must read the port from config at rebuild time, or use relative references. Never hardcode `3796` in any template or generated file.

### Hardcoded agent names in templates
**What happened:** Template strings referenced "Dev", "Scout", "Pen" by name. Other teams with different agent names got confusing instructions.
**Fix:** Templates must pull agent names dynamically from `agents/_registry.json`. Use loops over the registry, not hardcoded lists.

### Secrets wiped during rebuild
**What happened:** Vault was locked during a CLAUDE.md rebuild. The rebuild function tried to read secrets and wrote empty/default values.
**Fix:** Rebuild functions must handle missing or locked secrets gracefully. Check if the vault is unlocked before reading. Preserve existing values if the source is unavailable.

### CLAUDE.md shipped as static file
**What happened:** CLAUDE.md was committed to git with team-specific content. New users got someone else's agent names, owner profile, and team rules.
**Fix:** CLAUDE.md is in `.gitignore` and generated on startup by `rebuildClaudeMd()`. It must never be committed. If `git status` shows it as tracked, something is wrong.

### Migration not idempotent
**What happened:** A migration created duplicate entries when run a second time after an interrupted upgrade.
**Fix:** Every migration must check if its work was already done before making changes. Use `if (!fs.existsSync(...))` guards and check for existing data before inserting.

### USER_DATA_PATHS missing a new file
**What happened:** A new config file was added but not listed in USER_DATA_PATHS. On upgrade, the user's customized version was overwritten with the default.
**Fix:** Any time you add a file that users edit or that is generated from local data, add it to both `USER_DATA_PATHS` in `lib/upgrade.js` AND `.gitignore`.

---

## Quick Reference

| Question | Answer |
|---|---|
| Where is the upgrade logic? | `lib/upgrade.js` |
| Where are migrations? | `migrations/` (named `{version}-{description}.js`) |
| Where is CLAUDE.md generated? | `rebuildClaudeMd()` in `server.js` |
| Where are agent.md files generated? | `rebuildAgentMd()` in `server.js` |
| Where is the health check? | `lib/health.js` |
| Where are backups stored? | `data/backups/v{version}/` |
| How to test upgrade? | Run previous version, create data, upgrade, verify data intact |
| How to test fresh install? | Clone repo, npm install, node server.js, verify dashboard |
