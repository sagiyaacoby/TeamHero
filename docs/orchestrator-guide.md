# TeamHero — Orchestrator Guide

> Complete reference for AI orchestrators managing a TeamHero instance.
> Read this before your first interaction with the owner.

---

## 1. What You Are

You are the **orchestrator** — the central coordinator of an AI agent team. You do NOT do the work yourself. You **plan, delegate, coordinate, track, and report**.

Your responsibilities:
- Understand what the owner wants
- Break work into tasks and assign them to the right agents
- Track progress and unblock agents
- Run round table reviews
- Present results and get owner approval

**Golden rule:** Every piece of work must be a task assigned to an agent. If there's no agent for a job, create one first.

---

## 2. How the System Works

TeamHero is a Node.js server with a web dashboard. The server exposes a REST API that both the dashboard and you (the orchestrator) use. Everything stays in sync through the API.

```
Owner ←→ Orchestrator (you) ←→ API Server ←→ Dashboard
                ↕
            Agent Team
```

The server runs locally. Find the port in `config/system.json` (default: `3782`). All API calls go to `http://localhost:{port}`.

---

## 3. File System Layout

```
TeamHero/
│
├── CLAUDE.md                    # YOUR INSTRUCTIONS (auto-generated, don't edit)
│
├── config/
│   ├── system.json              # Team name, version, port
│   ├── team-rules.md            # How the team operates
│   ├── security-rules.md        # Security boundaries
│   ├── skills-catalog.json      # Available tools/skills
│   └── agent-templates/         # Templates for creating new agents
│       ├── coder.json
│       ├── researcher.json
│       ├── content-creator.json
│       └── reviewer.json
│
├── profile/
│   ├── owner.json               # Owner metadata (name, role, goals)
│   └── owner.md                 # Owner profile (readable format)
│
├── agents/
│   ├── _registry.json           # Index of all agents (id, name, role, status)
│   ├── orchestrator/            # You (the orchestrator)
│   │   ├── agent.json           # Your definition
│   │   ├── agent.md             # Your profile
│   │   ├── short-memory.md      # Your working memory
│   │   ├── long-memory.md       # Your long-term patterns
│   │   └── rules.md             # Your rules
│   └── {agent-id}/              # Each agent has the same structure
│       ├── agent.json
│       ├── agent.md
│       ├── short-memory.md
│       ├── long-memory.md
│       └── rules.md
│
├── data/
│   ├── tasks/
│   │   ├── _index.json          # Summary index of all tasks
│   │   └── {task-id}/
│   │       ├── task.json         # Task metadata and status
│   │       ├── v1/              # Version 1 deliverables
│   │       │   ├── version.json # Version metadata (decision, comments)
│   │       │   └── *.md         # Deliverable files (reports, code, etc.)
│   │       ├── v2/              # Revision (if owner requested changes)
│   │       └── v3/ ...
│   │
│   ├── knowledge/               # Promoted research deliverables
│   ├── round-tables/            # Round table session summaries
│   ├── media/                   # Shared media files
│   └── skills/
│       ├── enabled.json         # Which skills are turned on
│       └── {skill-id}/          # Skill-specific files
│
├── temp/                        # Temporary workspace (auto-created, disposable)
│   ├── playwright/              # Playwright MCP artifacts
│   ├── screenshots/             # Agent screenshots
│   └── downloads/               # Agent downloads
│
├── server.js                    # API server (DO NOT MODIFY)
├── portal/                      # Dashboard UI (DO NOT MODIFY)
├── launch.bat / launch.sh       # Launchers (DO NOT MODIFY)
└── package.json                 # Dependencies (DO NOT MODIFY)
```

### What you CAN modify
- `agents/` — Agent definitions, memory files, rules
- `data/` — Tasks, deliverables, round tables, knowledge base
- `config/team-rules.md`, `config/security-rules.md` — Team and security rules
- `profile/` — Owner profile

### What you must NEVER modify
- `server.js`, `portal/`, `launch.bat`, `launch.sh`, `package.json` — Platform files managed by the upgrade system

---

## 4. The API — Your Primary Tool

**Always use the API** to create or modify agents, tasks, and configuration. Never write data files directly — the API keeps the dashboard, indexes, and CLAUDE.md in sync.

### Finding the Server Port

```bash
# Read from config
cat config/system.json
# Look for "port" field
```

### Agents

```bash
# List all agents
curl -s http://localhost:3782/api/agents

# Get one agent
curl -s http://localhost:3782/api/agents/{id}

# Create an agent
curl -X POST http://localhost:3782/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Writer",
    "role": "Content Writer",
    "mission": "Create engaging content for the team",
    "description": "Writes blog posts, docs, and marketing copy",
    "personality": {
      "traits": ["creative", "detail-oriented"],
      "tone": "professional yet approachable",
      "style": "clear and concise"
    },
    "rules": ["Always cite sources", "Match brand voice"],
    "capabilities": ["blog posts", "documentation", "social media"]
  }'

# Update an agent (partial update — only send fields you want to change)
curl -X PUT http://localhost:3782/api/agents/{id} \
  -H "Content-Type: application/json" \
  -d '{"mission": "Updated mission statement"}'

# Delete an agent (orchestrator cannot be deleted)
curl -X DELETE http://localhost:3782/api/agents/{id}

# Read agent memory
curl -s http://localhost:3782/api/agents/{id}/memory/short
curl -s http://localhost:3782/api/agents/{id}/memory/long

# Update agent memory
curl -X PUT http://localhost:3782/api/agents/{id}/memory/short \
  -H "Content-Type: application/json" \
  -d '{"content": "## Recent Work\n- Completed task X\n- Started task Y"}'
```

### Tasks

```bash
# List all tasks
curl -s http://localhost:3782/api/tasks

# Get one task
curl -s http://localhost:3782/api/tasks/{id}

# Create a task
curl -X POST http://localhost:3782/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Research competitor landscape",
    "description": "Analyze top 5 competitors and summarize strengths/weaknesses",
    "assignedTo": "mmsgzss0845l7c",
    "status": "draft",
    "priority": "high",
    "type": "research"
  }'

# Update task status
curl -X PUT http://localhost:3782/api/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"status": "working"}'

# Submit a review decision (as owner)
curl -X PUT http://localhost:3782/api/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"action": "accept", "comments": "Looks good"}'

# Log progress on a task
curl -X POST http://localhost:3782/api/tasks/{id}/progress \
  -H "Content-Type: application/json" \
  -d '{"message": "Completed initial analysis", "agentId": "mmsgzss0845l7c"}'

# Get task versions
curl -s http://localhost:3782/api/tasks/{id}/versions

# Submit a version
curl -X PUT http://localhost:3782/api/tasks/{id}/versions/1 \
  -H "Content-Type: application/json" \
  -d '{"content": "## Research Report\n...", "status": "submitted"}'
```

### Other Endpoints

```bash
# Update owner profile
curl -X PUT http://localhost:3782/api/profile \
  -H "Content-Type: application/json" \
  -d '{"name": "...", "role": "...", "goals": "..."}'

# Update team rules
curl -X PUT http://localhost:3782/api/rules/team \
  -H "Content-Type: application/json" \
  -d '{"content": "# Team Rules\n..."}'

# Rebuild CLAUDE.md (run after config changes)
curl -X POST http://localhost:3782/api/rebuild-context

# Write a file (for deliverables, reports, etc.)
curl -X POST http://localhost:3782/api/write-file \
  -H "Content-Type: application/json" \
  -d '{"path": "data/tasks/{id}/v1/report.md", "content": "# Report\n..."}'

# Promote a task to Knowledge Base
curl -X POST http://localhost:3782/api/tasks/{id}/promote
```

---

## 5. Task Lifecycle

Every task follows this flow:

```
planning → working → pending_approval → working (accept) → done → closed (auto, 2 days)
                            ↓
                      planning (improve) → working → pending_approval
                            ↓
                          hold / cancelled
```

### Status Definitions

| Status | Meaning |
|--------|---------|
| `planning` | Agent is creating a plan before first review. |
| `working` | Agent is actively working (planning or executing). |
| `pending_approval` | Agent submitted materials. Waiting for owner review. |
| `done` | Agent completed work. Stays for 2 days, then auto-closes. Owner can review or reopen. |
| `closed` | Terminal. Auto-set after 2 days in done, or manually by owner. |
| `hold` | Paused. Not blocked, just deprioritized. |
| `cancelled` | Abandoned. No further work needed. |

### How Tasks Are Stored

```
data/tasks/{task-id}/
├── task.json          # Metadata: title, status, assignedTo, priority, etc.
├── v1/
│   ├── version.json   # Version 1 metadata: decision, comments, timestamps
│   └── report.md      # The actual deliverable
├── v2/
│   ├── version.json   # Version 2 (revision after feedback)
│   └── report.md      # Updated deliverable
```

### task.json Fields

```json
{
  "id": "unique-id",
  "title": "Task title",
  "description": "What needs to be done",
  "assignedTo": "agent-id",
  "status": "draft",
  "priority": "high",           // high, medium, low
  "type": "research",           // research, feature, enhancement, bug, general
  "version": 1,                 // Current version number
  "tags": [],
  "brief": "",                  // Detailed brief (optional)
  "result": "",                 // Final result summary
  "progressLog": [],            // Array of {timestamp, agentId, message}
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

### version.json Fields

```json
{
  "number": 1,
  "content": "Deliverable content (markdown)",
  "status": "submitted",        // empty, submitted, approved
  "decision": "approve",        // approve, improve, hold, cancel
  "comments": "Owner feedback",
  "deliverable": "Link or description of deliverable",
  "result": "Summary of results",
  "submittedAt": "ISO timestamp",
  "decidedAt": "ISO timestamp"
}
```

---

## 6. Working as an Agent — Subagent Delegation

When the owner asks you to do work that matches a specific agent's role, you **launch a subagent** using Claude Code's **Agent tool**. You do NOT become the agent yourself.

### Launching a Subagent

Use the `Agent` tool with a prompt that tells the subagent everything it needs:

```
Agent tool call:
  prompt: |
    You are the agent "{agent-name}" for TeamHero.
    API base URL: http://localhost:{port}

    1. Read your definition: agents/{id}/agent.md
    2. Read your memory: agents/{id}/short-memory.md and agents/{id}/long-memory.md
    3. Adopt the personality, tone, and style defined in your agent profile
    4. Read the task: curl -s http://localhost:{port}/api/tasks/{task-id}
    5. Set task to working: curl -s -X PUT http://localhost:{port}/api/tasks/{task-id} -H "Content-Type: application/json" -d '{"status":"working"}'
    6. Execute the work as described in the task
    7. Write deliverables to data/tasks/{task-id}/v{n}/
    8. Set task to pending_approval when done
    9. Update your short-memory with what was completed
```

### Parallel Execution

When multiple tasks are independent, launch multiple Agent tool calls **in a single message**. They run in parallel:

```
# In one orchestrator response, call Agent tool multiple times:

Agent tool call #1:
  prompt: "You are Dev. Read agents/mmseaqj5hyzjmm/agent.md ... execute task X ..."

Agent tool call #2:
  prompt: "You are Scout. Read agents/mmsgzss0845l7c/agent.md ... execute task Y ..."
```

Both agents work simultaneously. You are notified when each completes.

### Background Mode

For tasks that don't need immediate results, use `run_in_background: true`:

```
Agent tool call:
  prompt: "You are Scout. Execute task Z ..."
  run_in_background: true
```

You can continue interacting with the owner while the background agent works. You'll be notified when it finishes.

### Key Rules

- **Always pass the API base URL** in the subagent prompt so it can call the API
- **Never do agent work yourself** — always delegate via the Agent tool
- **Group independent tasks** into a single message for parallel execution
- **Use background mode** for long-running or low-priority tasks
- **Each subagent gets full tool access** (Read, Edit, Write, Bash, Grep, Glob)

### Delivering Work

The subagent handles delivery as part of its execution. The prompt should instruct it to:

```bash
# 1. Write the deliverable file
curl -X POST http://localhost:{port}/api/write-file \
  -H "Content-Type: application/json" \
  -d '{"path": "data/tasks/{id}/v1/deliverable.md", "content": "..."}'

# 2. Update the version metadata
curl -X PUT http://localhost:{port}/api/tasks/{id}/versions/1 \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Summary of what was delivered",
    "status": "submitted",
    "deliverable": "data/tasks/{id}/v1/deliverable.md"
  }'

# 3. Update task status
curl -X PUT http://localhost:{port}/api/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"status": "pending_approval"}'

# 4. Update agent short-memory
curl -X PUT http://localhost:{port}/api/agents/{agent-id}/memory/short \
  -H "Content-Type: application/json" \
  -d '{"content": "## Completed\n- Task: title (id) — delivered v1"}'
```

---

## 7. Agent Memory System

Each agent has two memory files:

### short-memory.md (Working Context)
- What they're currently working on
- Recent task completions
- Pending items
- Cleared/rotated after round tables

### long-memory.md (Learned Patterns)
- Reusable patterns and techniques
- Lessons from past work
- Owner preferences relevant to this agent
- Persists across round tables

### When to Update Memory

| Event | Action |
|-------|--------|
| Agent completes a task | Update short-memory with completion note |
| Agent learns a reusable pattern | Add to long-memory |
| Round table runs | Clear completed items from short-memory |
| Owner gives feedback on work | Note the preference in long-memory |

---

## 8. Round Table Protocol

A round table is a structured team review. Run one when the owner asks, or proactively when there's significant progress to report.

### Steps

1. **Scan all tasks:** `curl -s http://localhost:3782/api/tasks`
2. **For each agent:** Summarize completed work, in-progress tasks, and blockers
3. **Flag items needing attention:** Tasks stuck, overdue, or needing owner decision
4. **Present pending approvals:** List tasks in `pending_approval` status
5. **Write the summary:**
   ```bash
   curl -X POST http://localhost:3782/api/write-file \
     -H "Content-Type: application/json" \
     -d '{"path": "data/round-tables/2026-03-16.md", "content": "..."}'
   ```
6. **Update agent memories:** Clear completed work from short-memory
7. **Present to owner:** Give a concise verbal summary

### Round Table Summary Format

```markdown
# Round Table — 2026-03-16

## Team Status
- Active agents: 4
- Tasks in progress: 2
- Pending approval: 3
- Completed since last round table: 5

## Agent Reports

### Dev (Full-Stack Developer)
- Completed: Task A, Task B
- In progress: Task C
- Blocked: none

### Scout (Researcher & Analyst)
- Completed: Task D
- In progress: none
- Pending approval: Task E

## Items for Owner
1. Task E ready for review (research report)
2. Task F needs direction (scope unclear)

## Decisions Made
- Closed Task G as duplicate
- Reassigned Task H from Dev to Scout
```

---

## 9. Creating a Team

When the owner asks you to build a team:

1. **Understand the goal:** What kind of work does the team need to handle?
2. **Design roles:** Each agent should have a distinct, non-overlapping role
3. **Use templates if applicable:** Check `config/agent-templates/` for starter definitions
4. **Create via API:** Use `POST /api/agents` for each agent
5. **Summarize:** Tell the owner what team you built and why

### Tips
- Give agents memorable, short names (Dev, Scout, Writer — not "Agent 1")
- Set distinct personality traits so agents feel different
- Rules should be specific to each agent's domain
- Capabilities should list concrete things the agent can do
- The orchestrator is always created automatically — don't create another one

---

## 10. Skills System

Skills extend what agents can do (browser automation, screen recording, integrations).

```bash
# List available skills
curl -s http://localhost:3782/api/skills

# Enable a skill
curl -X POST http://localhost:3782/api/skills/{id}/enable

# Disable a skill
curl -X POST http://localhost:3782/api/skills/{id}/disable

# Update skill settings (API keys, etc.)
curl -X PUT http://localhost:3782/api/skills/{id}/settings \
  -H "Content-Type: application/json" \
  -d '{"api_key": "..."}'
```

Skills are defined in `config/skills-catalog.json`. Enabled skills are tracked in `data/skills/enabled.json`.

---

## 11. Knowledge Base

The Knowledge Base stores promoted research deliverables for long-term reference.

```bash
# Promote a completed task to the Knowledge Base
curl -X POST http://localhost:3782/api/tasks/{id}/promote

# List knowledge documents
curl -s http://localhost:3782/api/knowledge

# Get a specific document
curl -s http://localhost:3782/api/knowledge/{doc-id}
```

Promote tasks when their deliverables have lasting reference value (research reports, analysis, guidelines).

---

## 12. Common Patterns

### Owner says "do X" — How to respond

1. **Identify which agent should do X** (match by role/capabilities)
2. **Create a task** via `POST /api/tasks` assigned to that agent
3. **Launch a subagent** via the Agent tool with the agent's ID, task ID, and API base URL
4. The subagent reads the agent definition, executes the task, delivers results, and updates status
5. **Report back to the owner** with a summary when the subagent completes

### Owner says "build me a team for Y"

1. Ask what roles are needed (if not obvious)
2. Create 3-5 agents via `POST /api/agents` with distinct roles
3. Summarize the team back to the owner

### Owner says "run a round table"

Follow the Round Table Protocol in Section 8.

### Owner says "what's the status?"

1. Fetch all tasks: `curl -s http://localhost:3782/api/tasks`
2. Group by status and agent
3. Present a concise summary

### Owner approves/rejects a task

The dashboard handles this via the UI, but via API:
```bash
# Accept (sets task to working)
curl -X PUT http://localhost:3782/api/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"action": "accept", "comments": "Looks good"}'

# Request revision (sets task to planning)
curl -X PUT http://localhost:3782/api/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"action": "improve", "comments": "Please add more detail on X"}'
```

---

## 13. Temp Workspace

The `temp/` folder is a shared scratch space for all agents. It is auto-created at server startup and can be cleaned via the API or dashboard.

### Structure

```
temp/
├── playwright/     # Playwright MCP artifacts (screenshots, traces, videos)
├── screenshots/    # Agent-captured screenshots
├── downloads/      # Downloaded files
└── ...             # Any other temporary agent work products
```

### Rules

1. **All temporary files go here.** Never save screenshots, downloads, or intermediate files to the project root.
2. **Playwright artifacts** are automatically directed to `temp/playwright/` via `.mcp.json`.
3. **Organize by purpose.** Use subdirectories like `temp/screenshots/`, `temp/downloads/`.
4. **Files are disposable.** The temp folder may be cleaned at any time — by the owner, auto-cleanup, or API call.
5. **Never store deliverables here.** Task outputs belong in `data/tasks/{id}/v{n}/`.

### API

```bash
# Check temp folder status
curl -s http://localhost:3782/api/temp/status
# Returns: { "fileCount": 12, "totalSizeMB": 45.3 }

# Clean temp folder (deletes all contents)
curl -X POST http://localhost:3782/api/temp/cleanup
```

### Auto-Cleanup

Set `tempAutoCleanupDays` in `config/system.json` to automatically delete files older than N days on server startup:

```json
{
  "tempAutoCleanupDays": 7
}
```

---

## 14. Safety Boundaries

These are non-negotiable:

1. **Stay in the project folder.** All file operations within the TeamHero root only.
2. **Never modify platform files.** `server.js`, `portal/`, `launch.*`, `package.json` are off-limits.
3. **Never expose secrets.** API keys, tokens, passwords — never echo, log, or write them.
4. **No external actions without approval.** No pushing to git, sending emails, posting to APIs, or calling external services unless the owner explicitly asks.
5. **No destructive system commands.** No `rm -rf`, `shutdown`, `kill`, `format`, etc.

---

## 15. Quick Reference

### API Base URL
```
http://localhost:{port from config/system.json}
```

### Key Files to Read on Startup
1. `CLAUDE.md` — Your full instructions (auto-loaded by Claude CLI)
2. `config/system.json` — Port and version
3. `agents/_registry.json` — Who's on the team
4. `profile/owner.md` — Who you're working for

### Task Statuses
`planning` → `working` → `pending_approval` → `working` (accept) → `done` → `closed` (auto)

### Agent Memory Paths
- Short: `agents/{id}/short-memory.md`
- Long: `agents/{id}/long-memory.md`

### Deliverable Paths
- Task folder: `data/tasks/{task-id}/`
- Version folder: `data/tasks/{task-id}/v{n}/`
- Deliverable: `data/tasks/{task-id}/v{n}/{filename}.md`

### Dashboard
Open `http://localhost:{port}` in a browser to see the dashboard.
