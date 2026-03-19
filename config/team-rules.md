# Team Rules

## #1 Rule: Plan First, Then Execute
- Every task follows: Plan -> Review -> Execute -> Verify -> Close
- Agent's FIRST action is creating a plan. Plan goes to pending_approval. Only AFTER approval does agent execute.
- Applies to ALL task types. Exception: owner says "just do it" or task is autopilot.
- When work is approved, execute fully - no stopping to ask again.
- Only flag genuine blockers (missing credentials, need owner's personal account login).

## Delegation & Task Tracking (HARD RULE)
- The orchestrator MUST delegate ALL work to agents via tasks. NEVER do agent work yourself.
- ALL work must be tracked as tasks. No untracked work. Ever.
- If a session dies, every piece of in-flight work must be recoverable from the task system.
- The orchestrator's role is ONLY: plan, delegate, coordinate, track, and present results to the owner.

### What the orchestrator MUST NOT do
- Never write code, research, content, or any deliverable
- Never use EnterPlanMode for implementation planning - create a task instead
- Never explore the codebase or read files to understand architecture - delegate to Scout
- Never touch portal/ or server.js directly - that's Dev's job
- Never execute shell commands for real work (git, file ops, releases, GitHub) - delegate to the appropriate agent

### What the orchestrator MUST do
- Create a task BEFORE any work begins - even small things
- Assign to the right agent (Dev=code, Scout=research, Pen=content, Buzz=growth, Shipper=releases)
- Launch agents via the Agent tool with full context (agent identity, memory files, task ID, API URL)
- Track progress and report to the owner. The task system is the SINGLE SOURCE OF TRUTH.

## Task Lifecycle

### Flow: Prepare -> Review -> Execute -> Verify -> Close

**Phase 1: Plan (MANDATORY)**
1. Set `in_progress`. Log "Planning: {what I will do}"
2. Create plan: What will be done, How, which files/sources/platforms
3. Save plan to `data/tasks/{id}/v{n}/plan.md`
4. Update version.json: `content` (REQUIRED) + `deliverable` (path to plan)
5. Set `pending_approval`. STOP and wait.

**Phase 2: Execute (after owner accepts)**
6. Set `in_progress`. Log "Executing: {action}"
7. Execute the approved work
8. If blocker: `PUT /api/tasks/{id} {"blocker":"reason"}` and STOP
9. Update version.json: `content` (summary) + `result` (proof - URLs, file paths, verification)
10. **Auto-close if proof is concrete** (live URL, merged PR, deployed code). Otherwise `pending_approval`.

### Status Meanings
- **planning**: Creating plan/materials before first review
- **in_progress**: Executing after acceptance
- **pending_approval**: Materials ready for review OR execution proof ready for verify
- **accepted**: Owner approved - triggers agent execution immediately
- **revision_needed**: Owner sent feedback - agent revises, resubmits
- **closed**: Terminal. No agent should touch it.
- **hold**: Paused. Do not work until released.
- **cancelled**: Abandoned.

### Two pending_approval phases
1. **First** (after planning): version has plan, no execution result yet
2. **Second** (after execute): version has proof (URLs, screenshots, final files)

### Rules
- Tasks start in `planning`. Agent creates plan before submitting.
- Accept = execute (not auto-close). Improve = revise and resubmit.
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

## Agent Execution Guards
- Agents may ONLY begin work when the orchestrator launches them
- Never work on tasks in `pending_approval`, `hold`, `closed`, or `cancelled` status
- Never create a new version (v2, v3...) unless owner sent revision feedback
- When `accepted`, orchestrator launches agent to EXECUTE (not auto-close)
- When `revision_needed`, read owner's feedback and submit a new revision

## Task Structure (HARD RULE)
- Multi-step or multi-agent work MUST use parent/child task structure
- Create parent first, then subtasks via `POST /api/tasks/{parentId}/subtasks`
- Parent tasks are containers - may or may not be assigned to an agent
- Subtask fields: `parentTaskId`, `subtasks[]`, `dependsOn[]`
- When all subtasks reach accepted/closed, parent auto-advances to `pending_approval`
- Tasks with `dependsOn` wait until all dependencies are accepted/closed
- Never create 3+ related flat tasks when parent/child would group them

## Deliverable Tracking (MANDATORY)
Every closed task MUST have visible outcomes. Update version.json with:
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

## Token Efficiency
- Use the cheapest tool that gets the job done
- Playwright: avoid unnecessary snapshots (5000+ tokens each). Trust actions, use targeted checks.
- Don't fetch data you don't need. Use offset/limit for large files. Don't repeat searches.

## Round Table Protocol

Round tables are **execution-first**. Act before reporting.

### Phase 1: Execute
1. Launch agents on accepted tasks (EXECUTE, not auto-close)
2. Launch agents on revision_needed tasks
3. Launch agents on ready planning tasks
4. Report blockers directly (don't re-investigate)

### Phase 2: Surface blockers
- Tasks with `blocker` field set
- Tasks stuck on unmet dependencies
- Stalled in_progress tasks
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
