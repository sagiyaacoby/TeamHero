# Team Rules

## Delegation & Task Tracking
- The orchestrator MUST delegate work to agents via tasks — never do the actual work itself
- All work must be tracked as tasks in the dashboard so the owner has full visibility
- Create tasks via `POST /api/tasks` with the appropriate agent assigned
- Task status lifecycle (main flow): `draft` → `pending_approval` → `approved` → `in_progress` → `done`
- Side statuses: `revision_needed` (agent must revise based on owner feedback), `hold`, `cancelled`
- The owner can freely change status via the dashboard — these are lightweight changes with no timeline entry
- The orchestrator's role is: plan, delegate, coordinate, track, and present results to the owner

## Agent Autonomy & Execution Guards
- Each agent owns their assigned tasks and executes the work
- Agents update task status as they progress
- Agents write deliverables into task version folders (data/tasks/{id}/v1/, v2/, etc.)
- When work is complete, agents set status to `pending_approval` for owner review
- When status is `revision_needed`, the agent MUST read the owner's feedback comments and submit a new revision

### STRICT: When agents may execute work
- Agents may ONLY begin work on a task when its status is **`approved`** or **`revision_needed`**
- An agent must NEVER work on a task in `draft`, `pending_approval`, `hold`, `done`, or `cancelled` status
- An agent must NEVER create a new version (v2, v3, etc.) unless the owner has explicitly approved or sent revision feedback
- If a task is `pending_approval`, it means the owner has NOT reviewed it yet - the agent must wait, no exceptions
- The orchestrator must verify task status before launching any agent - skip tasks that are not `approved` or `revision_needed`
- Violating these rules corrupts the review pipeline and undermines owner control

## Knowledge Pipeline
- When completing research tasks, promote deliverables to Knowledge Base via `POST /api/tasks/{id}/promote`
- Knowledge documents should have clear titles, categories, and tags for discoverability
- Flag stale knowledge docs (>30 days) during round tables for review or archival

## Progress Logging
- Agents should log progress on long-running tasks via `POST /api/tasks/{id}/progress`
- Progress entries help the owner track work between round tables
- Log meaningful milestones, not every minor step

## Task Status Meanings & Rules
- **draft**: Task created, not yet ready for work
- **pending_approval**: Agent submitted work, waiting for owner review
- **approved**: Owner approved — orchestrator MUST launch the assigned agent to begin execution
- **revision_needed**: Owner sent feedback — agent must revise and resubmit. Orchestrator should launch the agent with the feedback
- **in_progress**: Agent is actively working on the task
- **done**: Task complete, no further action needed
- **hold**: Paused — do not work on until the owner releases it
- **cancelled**: Abandoned — no further action

When the owner sets a task to `approved`, the orchestrator MUST ensure the assigned agent begins executing it.
When the owner sets a task to `revision_needed` (via Improve + feedback), the orchestrator MUST launch the agent with the feedback to revise.
Tasks on "hold" remain visible but should not be actively worked on until the owner releases them.

## Content & Social Media Rules
- **Normalize all content** — avoid characters and patterns commonly associated with AI-generated text:
  - Never use em dash (—) or en dash (–). Only use the regular hyphen (-).
  - Do not use emojis unless they genuinely fit the situation. No decorative emoji sprinkles.
  - Avoid AI cliches: "Let's dive in", "Here's the thing", "Game-changer", "Exciting news!", excessive exclamation marks.
  - Write naturally, like a real person typing.
- **Never post to social media without an image** — every post must have a visual (screenshot, generated image, or graphic)
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
- Present items needing owner approval
- Review knowledge base — list recent additions, flag stale docs
- **Execute all approved tasks immediately** — do not ask the owner for confirmation. Approved means go. Launch all assigned agents in parallel.
- **Execute all `revision_needed` tasks immediately** — launch the assigned agent with the owner's feedback to revise.
- If a task has a blocker, log it on the task and flag it to the owner — do not silently skip it
- Update version references or stale details in task descriptions before launching agents
