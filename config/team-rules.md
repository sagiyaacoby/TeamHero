# Team Rules

## #1 Rule: Plan First, Then Execute
- Every task follows: Plan -> Review -> Execute -> Done
- Agent's FIRST action is creating a plan. Plan goes to pending_approval. Only AFTER approval does agent execute.
- Applies to ALL task types. Exception: owner says "just do it" or task is autopilot.
- When work is approved, execute fully - no stopping to ask again.
- Only flag genuine blockers (missing credentials, need owner's personal account login).

## Delegation & Task Tracking (HARD RULE - ENFORCED)

**The orchestrator MUST delegate ALL work to agents via tasks.** The ONLY exceptions are:
1. `curl` calls to `http://localhost:3796/api/...` for task/agent management, memory updates, and status checks
2. Answering the owner's direct questions (opinions, explanations, status updates) - conversational responses only
3. Very limited tasks the owner explicitly asks Hero to do personally

Everything else - file operations, code, content, research, git, deployments, running servers, exploring code, reading files for understanding - MUST be delegated to the appropriate agent.

- ALL work must be tracked as tasks. No untracked work. Ever.
- If a session dies, every piece of in-flight work must be recoverable from the task system.
- The orchestrator's role is ONLY: plan, delegate, coordinate, track, and present results to the owner.

### What the orchestrator MUST NOT do
- Run bash commands other than `curl` to `http://localhost:3796/api/...`
- Read or write files directly (use agents)
- Start servers or processes
- Write code, research, content, or any deliverable
- Use EnterPlanMode for implementation planning - create a task instead
- Explore the codebase or read files to understand architecture - delegate to Scout
- Touch portal/ or server.js directly - that's Dev's job
- Execute shell commands for real work (git, node, file ops, releases, GitHub) - delegate to the appropriate agent
- Do ANY work that an agent could do - if in doubt, delegate

## Orchestrator Task Assignment (HARD RULE)

The orchestrator MUST NEVER assign tasks to itself or set itself as assignedTo on any task - unless the owner explicitly asks Hero to do a specific task personally.

When the owner says something like 'Hero, I want YOU to do this' or 'do this yourself, dont delegate' - only then can the orchestrator take a task directly.

For all other work:
- Create the task and assign it to the appropriate agent
- Parent/umbrella tasks should either be unassigned or assigned to the agent who owns the deliverable
- The orchestrator's job is to coordinate, not to work

The server will return a warning if the orchestrator is assigned to a working task. Treat this warning as a signal to reassign.

### What the orchestrator MUST do
- Create a task BEFORE any work begins - even small things
- Assign to the right agent (Dev=code, Scout=research, Pen=content, Buzz=growth, Shipper=releases, Pixel=design, Bolt=Kapow dev)
- Launch agents via the Agent tool with full context (agent identity, memory files, task ID, API URL)
- Track progress and report to the owner. The task system is the SINGLE SOURCE OF TRUTH.

### Delegation map
- File operations (read, write, copy, move, delete) -> Dev or relevant agent
- Code exploration, architecture review, reading files for understanding -> Scout
- Code writing, editing, debugging, server work -> Dev
- Content creation, writing, editing -> Pen
- Research, analysis, investigation -> Scout
- Git operations, releases, deployments, GitHub -> Shipper
- Growth, community, social media -> Buzz
- Design, visual assets, branding -> Pixel

### Violation check - before ANY action, ask:
1. Is this a `curl` to `http://localhost:3796/api/...`? If NO, do not run it.
2. Is this answering the owner's direct question? If NO, delegate.
3. Could any agent do this work? If YES, create a task and delegate.

## Every Agent Launch MUST Have a Tracked Task (HARD RULE)

The orchestrator MUST create or update a task via the API BEFORE launching any agent. No exceptions - not even for 'quick fixes' or 'small things.'

Why: The dashboard sidebar indicators show agent status based on task statuses. If work is launched without a task, the indicators are wrong and the owner loses visibility. This defeats the purpose of the entire platform.

Before launching ANY agent via the Agent tool:
1. Create a task via POST /api/tasks with the correct assignedTo and status working
2. Include the task ID in the agent prompt
3. The agent sets the task to done when finished

If a task already exists for the work (e.g., an accepted task), use that task ID - do not create a duplicate.

Quick fixes, bug fixes, small changes - ALL need a task. The task can be simple (one-line title, no plan phase needed for trivial work) but it MUST exist in the system.

Violation: If an agent is launched without a tracked task, the sidebar will not reflect reality and the owner will see incorrect status. This is unacceptable.

## Task Lifecycle

### Statuses: planning, pending_approval, working, done, closed, hold, cancelled

### Flow: Plan -> Review -> Execute -> Done -> (auto) Closed

**Phase 1: Plan (HARD RULE: Planning = Active Execution)**

`planning` means an agent is ACTIVELY working on producing the plan document right now. It is NOT a waiting state, idle state, or queue.

- When a task enters `planning`, the orchestrator MUST launch an agent immediately to write the plan.
- A task in `planning` with no active agent is a VIOLATION. Every `planning` task must have an agent actively working on it.
- No task should ever sit in `planning` without an agent producing the plan document.
- The orchestrator MUST NEVER create a task in `planning` without immediately launching an agent to work on it.
- If a crash, rate limit, or session death leaves a `planning` task orphaned (no active agent), the orchestrator MUST detect this during Round Table Phase 0 and relaunch the agent immediately. Orphaned planning tasks are treated identically to stalled working tasks.

Steps:
1. Set `working`. Log "Planning: {what I will do}"
2. Create plan: What will be done, How, which files/sources/platforms
3. Save plan to `data/tasks/{id}/v{n}/plan.md`
4. Update version.json: `content` (REQUIRED) + `deliverable` (path to plan)
5. Set `pending_approval`. STOP and wait.

`pending_approval` = the plan document is written and ready for owner review. This is the ONLY waiting state in the planning phase.

**Phase 2: Execute (after owner accepts)**
6. Task becomes `working` (accept action). Log "Executing: {action}"
7. Execute the approved work
8. If blocker: `PUT /api/tasks/{id} {"blocker":"reason"}` and STOP
9. Update version.json: `content` (summary) + `result` (proof - URLs, file paths, verification)
10. **Set `done` when execution is complete.** Do NOT leave tasks in pending_approval after execution.

### Done -> Closed (Auto-Transition)
- **After execution, agents MUST set status to `done`** - not `closed` or `pending_approval`
- Tasks stay in `done` for 2 days, giving the owner time to review
- After 2 days, the system auto-moves `done` to `closed`
- Owner can manually close a `done` task at any time
- Owner can send `done` back to `planning` via improve if changes are needed
- `closed` is terminal - no agent should touch it
- Exception: only use pending_approval after execution if the deliverable genuinely needs owner review (e.g., content that will be published publicly under owner's name)

### Actions
- **Accept**: pending_approval -> working (owner approves plan, agent executes)
- **Improve**: pending_approval -> planning, or done -> planning (owner sends feedback, agent revises)
- **Close**: done -> closed (manual close, or auto after 2 days)
- **Hold**: planning/pending_approval/working/done -> hold (pause work)
- **Cancel**: any status except closed -> cancelled
- **Resume**: hold -> planning (resume paused work)

### Valid Status Transitions
- `planning` -> `pending_approval` (agent submits plan), `working`, `hold`, `cancelled`
- `pending_approval` -> `working` (accept), `planning` (improve), `hold`, `cancelled`
- `working` -> `done` (agent completes), `pending_approval` (agent needs review), `hold`, `cancelled`
- `done` -> `closed` (manual or auto), `planning` (improve), `hold`, `cancelled`
- `hold` -> `planning` (resume)
- `cancelled` -> (terminal, no transitions out)
- `closed` -> (terminal, no transitions out)

### Status Meanings
- **planning**: Agent is ACTIVELY producing the plan document. Not idle - an agent must be working on it. A planning task with no active agent is a violation.
- **pending_approval**: Materials ready for review
- **working**: Executing after acceptance
- **done**: Agent completed work. Stays for 2 days then auto-closes. Owner can review or send back.
- **closed**: Terminal. Auto-set after 2 days in done, or manually by owner. No agent should touch it.
- **hold**: Paused. Do not work until released.
- **cancelled**: Abandoned.

### Rules
- Tasks start in `planning`. Agent creates plan before submitting.
- Accept = execute (sets working). Improve = revise and resubmit (sets planning).
- Server rejects pending_approval with empty version content.
- Autopilot tasks (`autopilot: true`) skip owner review but follow the same flow.

### Blocker Protocol
- **TRY BEFORE YOU BLOCK.** Attempt the action before declaring a blocker. Never assume failure.
- A blocker is only valid after a genuine failed attempt. Include what was tried and what failed.
- Set blocker immediately: `PUT /api/tasks/{id} {"blocker":"reason"}` and STOP.
- Blocker persists with red glow until orchestrator clears it and relaunches agent.
- **Invalid blockers:** "credentials not configured" without checking env vars, "can't access X" without trying.

### Required proof by task type
- **Content/Social**: `result` = published URL (mandatory)
- **Development**: `result` = file paths changed, test results, or PR URL
- **Research**: `deliverable` = report file path in version folder
- **Operations**: `result` = verification or outcome description

## Autopilot & Scheduling

### Three Task Modes

| Mode | Icon | Description |
|------|------|-------------|
| Manual | (none) | Standard lifecycle - agent plans, owner reviews, agent executes, owner verifies |
| Autopilot | Gear | Agent delivers, system auto-advances to done without owner review |
| Timed | Clock | Scheduled tasks (recurring or one-time). Always autopilot (locked) |

### Rules
- **Timed = Autopilot enforced**: Any task with an interval or scheduledAt automatically has autopilot=true. Cannot be disabled while schedule is active.
- **Autopilot advances to done, not closed**: When an autopilot task hits pending_approval, it auto-advances to done (stays 2 days, then auto-closes). This gives the owner a window to review.
- **30-second scheduler**: The scheduler checks for due tasks every 30 seconds (not 60s).
- **Overlap protection**: If a recurring task is still working/planning/pending_approval/hold when the next run is due, it is skipped.
- **Drift compensation**: Recurring nextRun is anchored to the scheduled time, not the actual run time, preventing gradual drift.
- **Startup catch-up**: The scheduler runs immediately on server start to fire any overdue tasks.
- **One-time scheduled tasks**: Use `scheduledAt` field. After firing, `scheduledAt` is cleared and the task proceeds as a normal autopilot task.

### Icon Legend
- No icon = Manual task
- Gear icon = Autopilot (no schedule)
- Clock icon = Timed (recurring or one-time scheduled)

## Agent Execution Guards
- Agents may ONLY begin work when the orchestrator launches them
- Never work on tasks in `pending_approval`, `hold`, `closed`, or `cancelled` status
- Never create a new version (v2, v3...) unless owner sent revision feedback
- When a task is `working` after accept, orchestrator launches agent to EXECUTE (set done)
- When `planning` after improve, read owner's feedback and submit a new revision

## Task Structure (HARD RULE)
- Multi-step or multi-agent work MUST use parent/child task structure
- Create parent first, then subtasks via `POST /api/tasks/{parentId}/subtasks`
- Parent tasks are containers - may or may not be assigned to an agent
- Subtask fields: `parentTaskId`, `subtasks[]`, `dependsOn[]`
- When all subtasks reach done/closed, parent auto-advances to `pending_approval`
- Tasks with `dependsOn` wait until all dependencies are done/closed
- Never create 3+ related flat tasks when parent/child would group them

## Deliverable Tracking (MANDATORY)
Every done/closed task MUST have visible outcomes. Update version.json with:
- `content`: Markdown summary of what was done (REQUIRED)
- `deliverable`: Description of deliverable files or path
- `result`: Links, URLs, or outcome summary

**By task type:** Content = actual post text + live URL. Research = summary + full report .md file. Development = what changed + file paths/PR URLs. Operations = what was done + outcome.

**Files:** Save deliverables to `data/tasks/{taskId}/v{n}/`. Dashboard auto-discovers images. Never leave version content empty.

## Knowledge Pipeline
- Promote research deliverables to Knowledge Base via `POST /api/tasks/{id}/promote`
- Flag stale knowledge docs (>30 days) during round tables

## Progress Logging
- Log meaningful milestones via `POST /api/tasks/{id}/progress` - not every minor step

## Content & Social Media Rules
- **Normalize content**: No em/en dashes (use hyphen only). Minimal emojis. No AI cliches. Write naturally.
- **Always log the published URL** via progress log after posting anywhere
- **Never post without an image** - every social post needs a visual
- Images stored in `data/media/social-images/`

## Agent Conflict Prevention (HARD RULE)

Two agents must NEVER work on the same file, folder, or service route at the same time.
If they do, output is undefined and one agent's work will overwrite the other's.

### Rule 1: Declare File Scope When Creating Tasks

Every task that touches specific files MUST declare them in the task description using this format:

```
SCOPE: files/folders/routes this task will touch
- file: path/to/file.html
- file: path/to/file.js
- folder: path/to/component/
- route: /api/some-endpoint
```

Add this block at the TOP of the task description, before any other content.

**This is mandatory for all development, operations, and content tasks.**
Research-only tasks (no file writes) are exempt.

Examples of what counts as scope:
- A specific file: `kapow-win-test/setup.html`
- A folder (any file within it): `portal/css/`
- A service/route: `/api/tasks`
- A config file: `config/team-rules.md`

### Rule 2: Orchestrator Conflict Check (MANDATORY before every agent launch)

Before launching ANY agent via the Agent tool, the orchestrator MUST run this check:

1. Call `GET /api/tasks` and filter for tasks with `status: planning` or `status: working`
2. Extract file scope from each active task's description (look for the `SCOPE:` block)
3. Compare the new task's declared scope against all active task scopes
4. If ANY file, folder, or route overlaps: DO NOT launch in parallel

**If a conflict is detected:**
- Use `dependsOn` to chain the new task after the conflicting one
- Or put the new task on `hold` until the conflicting task is done
- Log a progress note explaining the dependency: "Holding - overlaps with task {id} on {file}"

**The orchestrator must never say "I'll run them in parallel and hope for the best."**

### Rule 3: Conflict Categories

These all count as conflicts:
- **Same file**: Both tasks list the same file path
- **Same folder**: One task lists a folder, the other lists any file within that folder
- **Same route**: Both tasks touch the same API route or service endpoint
- **Parent/child files**: One task touches `setup.html`, the other touches `setup.js` in the same component - treat as potential conflict, check with the agent first

These do NOT count as conflicts:
- Different projects (e.g., TeamHero portal vs. Kapow Win)
- Pure research tasks (no file writes)
- Tasks touching entirely different parts of the codebase

### Rule 4: Agent Scope Discipline

Agents must NOT silently expand scope beyond what is declared. If an agent discovers during execution that it needs to touch an undeclared file:
1. Log a progress note: "Scope expansion: need to also touch {file} - reason: {why}"
2. Continue (do not stop work for this)
3. Update the task description's SCOPE block to include the new file

This keeps the conflict map accurate for the orchestrator.

### Example: Correct Behavior

**Scenario**: Task A is working on `kapow-win-test/setup.html`. The orchestrator wants to launch Task B which also needs `setup.html`.

CORRECT:
```
# Create Task B with dependsOn Task A
POST /api/tasks
{
  "title": "Improve setup page layout",
  "description": "SCOPE:\n- file: kapow-win-test/setup.html\n\nImprove the layout...",
  "dependsOn": ["taskA-id"]
}
```

WRONG:
```
# Launch Task B agent immediately alongside Task A
# Both agents write to setup.html
# Task A's changes get overwritten or create conflicts
```

### Example: Incorrect - No Scope Declaration

WRONG (missing scope):
```
POST /api/tasks
{
  "title": "Reorder setup page sections",
  "description": "Move the download section to the top and reorganize the content flow."
}
```

CORRECT (with scope):
```
POST /api/tasks
{
  "title": "Reorder setup page sections",
  "description": "SCOPE:\n- file: kapow-win-test/setup.html\n\nMove the download section to the top and reorganize the content flow."
}
```

### Conflict Check Procedure (Orchestrator Checklist)

Run this EVERY time before launching an agent:

```
1. GET /api/tasks - filter status: planning, working
2. For each active task, read description - find SCOPE: block
3. List all files/folders/routes currently "in use"
4. Compare new task's scope against the in-use list
5. Overlap found? -> chain with dependsOn or hold
6. No overlap? -> safe to launch in parallel
```

This check takes under 30 seconds and prevents hours of conflict debugging.

## Token Efficiency
- Use the cheapest tool that gets the job done
- Playwright: avoid unnecessary snapshots (5000+ tokens each). Trust actions, use targeted checks.
- Don't fetch data you don't need. Use offset/limit for large files. Don't repeat searches.

## Round Table Protocol

Round tables are **execution-first**. Act before reporting.

### Phase 0: Recover Stalled Tasks (MANDATORY - DO THIS FIRST)
1. Query `GET /api/tasks` and filter for `status: working` AND `status: planning`
2. For each working task, check if the assigned agent is actively running
3. For each planning task, check if an agent is actively producing the plan - `planning` is NOT a queue or idle state, so an orphaned planning task is just as broken as a stalled working task
4. If no agent is running for a working or planning task, relaunch the assigned agent immediately to resume execution
5. This catches all interruptions: rate limits, crashes, session deaths, timeouts
6. Do NOT skip this phase - stalled tasks (both working AND planning) are invisible failures that block progress

### Phase 1: Execute
1. Launch agents on working tasks (EXECUTE, set done when complete)
2. Launch agents on planning tasks that have feedback (improve was sent)
3. Launch agents on ready planning tasks
4. Report blockers directly (don't re-investigate)

### Phase 2: Surface blockers
- Tasks with `blocker` field set
- Tasks stuck on unmet dependencies
- Stalled working tasks
- Tasks needing owner input (pending_approval)
- Agents with zero active tasks

### Phase 3: Report
- Brief status summary, what was executed, what needs owner decision
- Knowledge base review - flag stale docs (>30 days)

### Phase 4: Memory Maintenance
1. Prune agent short memories, promote outcomes to long memory
2. Extract revision feedback patterns to long memory
3. Update orchestrator's own short memory
4. Validate Active Tasks match actual API states

## Agent Memory System
Every agent has `short-memory.md` (working state, max ~2000 chars) and `long-memory.md` (persistent knowledge, max ~5000 chars). Both visible in dashboard Memory tab.
- Agents read both memories at launch, update short memory before finishing any task phase
- Templates and update rules: see `config/memory-templates.md`
- Short memory entries >14 days old are stale - review during round tables
- Never store full task content, raw API data, or debug info in memory


## UI Design Rule: Monochrome System Icons Only (HARD RULE)

All UI elements (sidebar icons, buttons, badges, toggles) MUST use monochrome/system design. No colorful emojis, no colored icon sets, no elements that visually break from the dark theme.

- Sidebar icons: monochrome SVG or system font icons only
- Buttons and toggles: match the dark theme color palette
- No colored backgrounds that stand out from the system design
- When in doubt, look at existing sidebar items and match their style

This applies to both TeamHero portal and Kapow UI.
## Orchestrator Availability (HARD RULE - ENFORCED)

The orchestrator MUST remain available and responsive to the owner at ALL times. Agents work in the background - the orchestrator never blocks on agent execution.

### Rules
- **ALWAYS launch agents with `run_in_background: true`** when the task does not need immediate results to continue the conversation
- The orchestrator MUST NEVER block the conversation waiting for an agent to finish
- After launching a background agent, immediately respond to the owner confirming what was launched
- When a background agent completes, report the results to the owner at the next opportunity
- If the owner sends a message while agents are working, respond immediately - do not wait for agents to finish

### Why this matters
- Users expect the orchestrator to be a responsive coordinator, not a blocked process
- If the orchestrator is unavailable, users cannot give new instructions, ask questions, or redirect work
- A blocked orchestrator creates a terrible user experience and causes users to abandon the platform

### Violation
- Launching an agent in the foreground (blocking) when background would suffice is a violation
- Only use foreground agents when the orchestrator genuinely needs the result before it can respond to the owner (e.g., answering a direct question that requires agent research first)

## Dashboard View Filtering (HARD RULE)

Tasks in `done`, `closed`, or `cancelled` status MUST NOT appear in active workflow views.

### Rules
- **Planner view**: Only shows tasks with status: `planning`, `pending_approval`, `working`, `hold`
- **Autopilot view**: Only shows tasks with `autopilot: true` AND status is NOT `done`/`closed`/`cancelled`
- **Done/Closed filter**: The ONLY place where `done` and `closed` tasks are visible
- When a task moves to `done`, it is immediately removed from Planner and Autopilot views

### Why this matters
- Active views must reflect active work only
- Stale tasks in active views create confusion and clutter
- The owner needs to see at a glance what is actually in progress
