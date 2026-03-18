# Team Rules

## #1 Rule: Mission-Driven Execution
- The team exists to EXECUTE and DELIVER results. Not plans. Not briefs. Not checklists. Results.
- Agents must DO the work, not describe how to do it
- If an agent can complete the action, it completes it. No stopping to ask when work was already approved.
- "Publishing briefs", "posting strategies", and "engagement plans" are NOT deliverables. The actual posted content, the actual code, the actual research findings are deliverables.
- Only flag genuine blockers (missing credentials, need owner's personal account login)
- Never set pending_approval for work that was already approved upstream - just finish it

## Delegation & Task Tracking
- The orchestrator MUST delegate work to agents via tasks - never do the actual work itself
- All work must be tracked as tasks in the dashboard so the owner has full visibility
- Create tasks via `POST /api/tasks` with the appropriate agent assigned
- The orchestrator's role is: plan, delegate, coordinate, track, and present results to the owner

## Task Lifecycle (CORRECTED FLOW)

### Flow: Prepare -> Review -> Execute -> Verify -> Close

```
           PREPARE                    REVIEW                 EXECUTE              VERIFY
  +-----------------+    +-------------------+    +-----------------+    +----------------+
  |   in_progress    |--->|  pending_approval  |--->|   in_progress    |--->|pending_approval |--> closed
  |  Agent prepares  |    |  Materials ready    |    |  Agent executes  |    | Proof attached   |
  |  materials/draft |    |  Owner reviews      |    |  (posts/builds)  |    | Owner verifies   |
  +-----------------+    +-------------------+    +-----------------+    +----------------+
                                |         |                   |
                                | Improve |                   | Blocker
                                v         |                   v
                           in_progress <--+              blocker set
                           Agent revises                 (red glow, persists)
```

1. **Prepare** (in_progress): Agent creates materials/draft/plan
2. **Submit for review** (pending_approval): Agent fills version.json + sets pending_approval
3. **Owner reviews**: Accept (go execute) or Improve (revise)
4. **Execute** (in_progress): Agent executes the approved work (posts content, deploys code, etc.)
5. **Submit proof** (pending_approval): Agent updates version with execution proof + sets pending_approval
6. **Owner verifies**: Checks proof (URL works, code deployed, etc.) and closes

### Status Meanings
- **Working** (`in_progress`): Agent preparing materials OR executing after acceptance
- **Pending** (`pending_approval`): Either materials ready for review OR execution proof ready for verify
- **Accepted** (`accepted`): Owner approved materials - triggers agent execution immediately
- **Improve** (`revision_needed`): Owner sent feedback - agent revises, resubmits to pending
- **Closed** (`closed`): Owner verified execution proof. Terminal state.
- **Hold** (`hold`): Paused - do not work on until the owner releases it.
- **Cancelled** (`cancelled`): Abandoned - no further action.

### The two pending_approval phases
Same status used twice, distinguished by the version content:
1. **First pending** (after prepare): version has draft content/materials, no execution result yet
2. **Second pending** (after execute): version has proof - URLs, screenshots, final files

Progress log distinguishes the phases automatically via timestamps.

### Rules
- There is NO draft status. When a task is created, the agent starts working immediately.
- When the owner clicks Accept, the agent must execute the approved work (not auto-close)
- When the owner clicks Improve and adds feedback, the agent must revise and resubmit
- When the owner marks a task as Closed, it is done forever. No agent should touch it.
- Server rejects pending_approval with empty version content

## Agent Execution Checklist

### Phase 1: Prepare
1. Set status to `in_progress`
2. Log progress: "Starting: {what I'm preparing}"
3. Create materials (draft post, code, research, etc.)
4. Save materials to `data/tasks/{id}/v{n}/`
5. Update version.json:
   - `content`: Description of what was prepared (REQUIRED)
   - `deliverable`: File paths of materials
6. Set status to `pending_approval`
7. STOP and wait for owner review

### Phase 2: Execute (after owner accepts)
8. Set status to `in_progress`
9. Log progress: "Executing: {what I'm doing}"
10. Execute the approved work (post to LinkedIn, deploy code, etc.)
11. If blocker: `PUT /api/tasks/{id} {"blocker": "reason"}` and STOP
12. Update version.json:
    - `content`: Updated with execution summary
    - `result`: Proof - URLs, screenshots, verification (REQUIRED for phase 2)
13. **Auto-close if proof is concrete.** If the agent has hard proof of delivery (published URL, deployed PR, completed action), set status directly to `closed`. Do NOT leave it in pending_approval waiting for the owner to verify obvious completions.
    - Content posted with a live URL? -> `closed`
    - Code merged with PR URL? -> `closed`
    - If proof is ambiguous or needs owner judgment -> `pending_approval`

### Blocker Protocol
- **TRY BEFORE YOU BLOCK.** An agent must ATTEMPT the action before declaring a blocker. Never assume failure.
  - Check environment variables exist before claiming "no credentials"
  - Open the browser and try before claiming "can't access platform"
  - Call the API before claiming "API unavailable"
  - A blocker is only valid after a genuine failed attempt. Include what was tried and what failed.
- Hit a real blocker? Set blocker field immediately: `PUT /api/tasks/{id} {"blocker": "reason"}`
- Blocker persists with red glow until explicitly cleared
- Do NOT keep working past a blocker - set it and stop
- When unblocked: orchestrator clears field and relaunches agent
- **Invalid blockers:** "credentials not configured" without checking env vars, "can't access X" without trying, any assumption-based blocker. These waste the owner's time and stall work.

### Required proof by task type
- **Content/Social**: `result` = published URL (mandatory)
- **Development**: `result` = file paths changed, test results, or PR URL
- **Research**: `deliverable` = report file path in version folder
- **Operations**: `result` = verification or outcome description

### Rules
- Server rejects pending_approval with empty version content
- Never skip the review phase - owner must see materials before execution
- Never close a content task without the published URL
- Log progress only when something meaningful changes
- Autopilot tasks skip owner review but still follow the same prepare->execute flow

## Autopilot
- Tasks with `autopilot: true` run the full lifecycle without human review
- Agent delivers work, orchestrator auto-accepts, auto-closes
- No owner in the loop - full automation
- Owner can toggle autopilot off at any time to re-enable human review
- Progress is still logged for audit

## Collaboration / Subtasks
- Parent tasks can have subtasks assigned to different agents
- Subtask fields: `parentTaskId`, `subtasks[]`, `dependsOn[]`
- Max 1 level deep (no subtasks of subtasks)
- When all subtasks reach Accepted or Closed, the parent auto-advances to Pending
- Tasks with `dependsOn` wait until all dependencies are Accepted/Closed before starting
- Create subtasks via `POST /api/tasks/{parentId}/subtasks`

## Deliverable Tracking (MANDATORY)

Every completed task MUST have visible outcomes in the task detail page. The owner must be able to open any closed task and see exactly what was done.

### How to submit deliverables

When an agent finishes work, it MUST update the version.json with actual content:

```bash
# Update version with content, deliverable summary, and result
curl -X PUT http://localhost:3791/api/tasks/{taskId}/versions/{vnum} \
  -H "Content-Type: application/json" \
  -d '{"content":"Markdown summary of what was done","deliverable":"Description of deliverable files","result":"Links, URLs, or outcome summary"}'
```

### Required fields per task type

- **Content/Social tasks**: `content` = the actual post text. `result` = the live URL where it was published. Save any images/screenshots to the version folder.
- **Research tasks**: `content` = research summary/findings. Save the full report as a .md file in the version folder.
- **Development tasks**: `content` = what was built/changed. `result` = relevant file paths, PR URLs, or test results.
- **Operations tasks**: `content` = what was done. `result` = outcome or verification.

### Files in version folders

- Save all deliverable files (images, reports, screenshots, GIFs) directly into `data/tasks/{taskId}/v{n}/`
- The dashboard auto-discovers these files and shows image thumbnails
- Use the write-file API: `POST /api/write-file` with `{"path":"data/tasks/{taskId}/v1/screenshot.png","content":"..."}`

### Links and URLs

- If the task involved posting content somewhere, the published URL MUST go in the `result` field
- If the task produced files in `data/media/`, reference their paths in the `deliverable` field
- Progress log URLs are good for audit, but the `result` field is what shows on the task page

### STRICT: No empty deliverables

- A task MUST NOT be set to `pending_approval` with empty `content` in its version
- Server enforces this - returns 400 if version content is empty
- The orchestrator should reject any task submission that has empty version content

## Agent Execution Guards
- Each agent owns their assigned tasks and executes the work
- Agents update task status as they progress (Working -> Pending)
- Agents write deliverables into task version folders (data/tasks/{id}/v1/, v2/, etc.)
- When work is complete, agents set status to `pending_approval` for owner review
- When status is `revision_needed`, the agent MUST read the owner's feedback comments and submit a new revision

### STRICT: When agents may execute work
- Agents may ONLY begin work on a task when the orchestrator launches them
- An agent must NEVER work on a task in `draft`, `pending_approval`, `hold`, `closed`, or `cancelled` status
- An agent must NEVER create a new version (v2, v3...) unless the owner has explicitly sent revision feedback
- If a task is `pending_approval`, the owner has NOT reviewed it yet - the agent must wait
- The orchestrator must verify task status before launching any agent
- When a task is `accepted`, the orchestrator launches the agent to EXECUTE (not auto-close)

### STRICT: Never re-submit already-closed work
- If a task status is `closed`, the agent must not touch it
- Only set to `pending_approval` when submitting NEW work the owner has not seen yet

## Knowledge Pipeline
- When completing research tasks, promote deliverables to Knowledge Base via `POST /api/tasks/{id}/promote`
- Knowledge documents should have clear titles, categories, and tags for discoverability
- Flag stale knowledge docs (>30 days) during round tables for review or archival

## Progress Logging
- Agents should log progress on long-running tasks via `POST /api/tasks/{id}/progress`
- Progress entries help the owner track work between round tables
- Log meaningful milestones, not every minor step

## Content & Social Media Rules
- **Normalize all content** - avoid characters and patterns commonly associated with AI-generated text:
  - Never use em dash or en dash. Only use the regular hyphen (-).
  - Do not use emojis unless they genuinely fit the situation. No decorative emoji sprinkles.
  - Avoid AI cliches: "Let's dive in", "Here's the thing", "Game-changer", "Exciting news!", excessive exclamation marks.
  - Write naturally, like a real person typing.
- **Always log the published URL** - after posting content anywhere (LinkedIn, Reddit, Dev.to, HN, Twitter/X, etc.), the agent MUST add the live URL to the task via progress log (`POST /api/tasks/{id}/progress`) so the owner can find it later, even after the task is closed
- **Never post to social media without an image** - every post must have a visual (screenshot, generated image, or graphic)
- Images are stored in `data/media/social-images/`
- To generate images, use the owner's ChatGPT instance via Chrome browser (owner will open it manually)
- When creating content tasks for social media, always include a companion image task or flag that an image is needed before posting

## Token Efficiency
- Always think token-savvy. Use the cheapest tool that gets the job done.
- Playwright: avoid unnecessary full page snapshots. Each snapshot can be 5000+ tokens. Only snapshot when you need to find an element or check state.
- After clicking/typing in Playwright, do not snapshot just to confirm - trust the action unless there is reason to doubt.
- Prefer targeted checks (evaluate, wait_for) over full snapshots.
- When calling APIs, avoid fetching data you do not need.
- When reading files, use offset/limit for large files instead of reading the whole thing.
- Do not repeat searches you already did. Cache results mentally within the conversation.

## Round Table Protocol

Round tables are **execution-first**. The orchestrator acts before it reports. No task should sit idle without the owner knowing why.

### Phase 1: Execute (do this BEFORE reporting)
1. **Launch agents on accepted tasks** - owner approved materials, agent must EXECUTE (not auto-close)
2. **Launch agents on revision_needed tasks** - owner already gave feedback, agent must act
3. **Launch agents on draft tasks** that are ready (assigned, dependencies met)
4. **Clear blockers** - read blocker field on tasks, report the text directly (don't re-investigate)
5. **Close tasks** that have been verified by owner (second pending_approval approved)

### Phase 2: Surface blockers
- Tasks with `blocker` field set - report the blocker text directly
- Tasks stuck waiting on unmet dependencies - name the blocker
- Tasks in_progress with no recent progress - may be stalled
- Tasks that need owner input before they can proceed (pending_approval)
- Agents with zero active tasks (available capacity)

### Phase 3: Report
- Brief status summary (not a wall of text)
- What was just executed in Phase 1
- What needs the owner's decision
- Knowledge base review - flag stale docs (>30 days)

### Rules
- Never leave tasks sitting idle without surfacing them
- The owner should never discover a stalled task by accident
- Work is properly delegated, not silently done by the orchestrator
- When a task is `accepted`, launch the agent to execute - do NOT auto-close
- If a task has a `blocker` field, report the blocker text and flag it to the owner

## Agent Memory System

Every agent has two memory files: `short-memory.md` (working state) and `long-memory.md` (persistent knowledge). Both are visible in the dashboard Memory tab.

### Short Memory Template

```markdown
# {Agent Name} - Short Memory
Last updated: {date}

## Active Tasks
- **{taskId}** - {title} | {status}
  - Current state: {one-line}
  - Next action: {what happens next}

## Recent Completions (last 7 days)
- **{taskId}** - {title} | Closed {date}
  - Outcome: {URL, file path, or one-line result}

## Working Context
- {Cross-task knowledge the agent needs right now}

## Blockers
- {taskId}: {blocker text}
```

### Long Memory Template

```markdown
# {Agent Name} - Long Memory

## Tools & Access
### Authenticated Platforms
- {Platform}: {access method, account, session status}

### Available Credentials
- {SERVICE}_USERNAME / _PASSWORD available as env vars

### Skills & Tools
- {Skill}: {status, how to use, quirks}

### Platform Constraints
- {Platform-specific limitations discovered during execution}

## Domain Knowledge
- {Learned facts, patterns, platform behaviors}

## Owner Preferences
- {Patterns from revision feedback}

## Lessons Learned
- {date}: {What happened, what to do differently}

## Completed Work Log
### {Month Year}
- {taskId} - {title} - {one-line outcome}
```

### Orchestrator Short Memory Template

```markdown
# Hero - Team State
Last updated: {date}

## Team Status
- {Agent}: {available | working on taskId - title}

## Pending Owner Decisions
- {taskId} - {title} - awaiting {what}

## Active Blockers
- {taskId} ({agent}): {blocker text}

## Last Round Table
- {date}: {2-3 line summary}
```

### Orchestrator Long Memory Template

```markdown
# Hero - Team Knowledge

## Tools & Access (Team-Wide)
### Credentials Vault
- {Service}: {status}

### Browser Sessions
- {Browser/account}: {status, shared with, constraints}

### Platform Status
- {Platform}: {current access status and constraints}

## Team Patterns
- {Observations about agent effectiveness}

## Campaign History
### {Campaign Name}
- Period: {dates} | Agents: {list} | Outcome: {summary}

## Process Improvements
- {date}: {What was changed and why}
```

### Memory Update Rules

| Event | Short Memory | Long Memory |
|-------|-------------|-------------|
| Task started | Add to Active Tasks | - |
| Task submitted (pending_approval) | Update status | - |
| Task closed | Move to Recent Completions | Add to Work Log |
| Revision feedback | Update task notes | Add to Owner Preferences if pattern |
| Blocker set | Add to Blockers | - |
| Blocker cleared | Remove from Blockers | Add to Platform Constraints if access issue |
| Auth discovered | - | Add to Tools & Access |
| Auth failed | - | Add to Tools & Access |
| New skill/tool used | - | Add to Skills & Tools |
| Round table | Full refresh | Promote aged items, consolidate |

**Mandatory:** Agent reads both memories at launch. Agent updates short memory before finishing any task phase.

### Round Table Phase 4: Memory Maintenance

After Phase 3 (Report), the orchestrator:
1. For each agent with completed tasks: prune short memory, promote outcomes to long memory
2. For agents with revision feedback: extract patterns to long memory
3. Update orchestrator's own short memory with current team state
4. Validate Active Tasks in short memories match actual API task states

Orchestrator does this directly via curl/API calls, not delegated to subagents.

### Memory Hygiene

- Short memory: max ~2000 chars. Prune oldest Recent Completions first.
- Long memory: max ~5000 chars. Consolidate Work Log into monthly summaries.
- Entries >14 days old in short memory are stale - review during round table.
- Never store full task content, raw API data, or debug info in memory.
