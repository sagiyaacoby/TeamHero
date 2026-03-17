# Team Rules

## Delegation & Task Tracking
- The orchestrator MUST delegate work to agents via tasks - never do the actual work itself
- All work must be tracked as tasks in the dashboard so the owner has full visibility
- Create tasks via `POST /api/tasks` with the appropriate agent assigned
- The orchestrator's role is: plan, delegate, coordinate, track, and present results to the owner

## Task Lifecycle

### Status Flow
```
Draft -> Working -> Pending -> Accepted -> Closed
                      |
                    Improve (side action)
```

### Status Meanings
- **Draft** (`draft`): Task created, not yet started. Orchestrator creates and assigns it, then launches the agent.
- **Working** (`in_progress`): Agent is actively working on the task.
- **Pending** (`pending_approval`): Agent delivered work, waiting for owner review. Owner can: Accept or Improve.
- **Accepted** (`accepted`): Owner accepted the deliverable. Result is final. Auto-closes or orchestrator closes.
- **Improve** (`revision_needed`): Owner sent feedback via Improve button. Agent must revise and resubmit to Pending.
- **Closed** (`closed`): Fully complete, archived. Terminal state. No further work.
- **Hold** (`hold`): Paused - do not work on until the owner releases it.
- **Cancelled** (`cancelled`): Abandoned - no further action.

### Rules
- When a task is created, the orchestrator launches the assigned agent immediately
- When the owner clicks Accept, the task moves to Accepted - deliverable is locked in
- When the owner clicks Improve and adds feedback, the agent must revise and resubmit
- When the owner marks a task as Closed, it is done forever. No agent should touch it.
- Accepted tasks should be closed by the orchestrator (or auto-close)

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

## Agent Execution Guards
- Each agent owns their assigned tasks and executes the work
- Agents update task status as they progress (Working -> Pending)
- Agents write deliverables into task version folders (data/tasks/{id}/v1/, v2/, etc.)
- When work is complete, agents set status to `pending_approval` for owner review
- When status is `revision_needed`, the agent MUST read the owner's feedback comments and submit a new revision

### STRICT: When agents may execute work
- Agents may ONLY begin work on a task when the orchestrator launches them
- An agent must NEVER work on a task in `draft`, `pending_approval`, `accepted`, `hold`, `closed`, or `cancelled` status
- An agent must NEVER create a new version (v2, v3...) unless the owner has explicitly sent revision feedback
- If a task is `pending_approval`, the owner has NOT reviewed it yet - the agent must wait
- The orchestrator must verify task status before launching any agent

### STRICT: Never re-submit already-accepted work
- If a task status is `accepted` or `closed`, the agent must not touch it
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

## Round Table Reviews
- Round tables must check that work is properly delegated, not silently done by the orchestrator
- Review each agent's task load and progress
- Flag any bottlenecks or unassigned work
- Present items needing owner approval (Pending tasks)
- Review knowledge base - list recent additions, flag stale docs
- Launch agents for any tasks that need work
- If a task has a blocker, log it on the task and flag it to the owner - do not silently skip it
