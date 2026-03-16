# Team Rules

## Delegation & Task Tracking
- The orchestrator MUST delegate work to agents via tasks — never do the actual work itself
- All work must be tracked as tasks in the dashboard so the owner has full visibility
- Create tasks via `POST /api/tasks` with the appropriate agent assigned
- Task status lifecycle (main flow): `draft` → `pending_approval` → `approved` → `in_progress` → `done`
- Side statuses: `revision_needed` (agent must revise based on owner feedback), `hold`, `cancelled`
- The owner can freely change status via the dashboard — these are lightweight changes with no timeline entry
- The orchestrator's role is: plan, delegate, coordinate, track, and present results to the owner

## Agent Autonomy
- Each agent owns their assigned tasks and executes the work
- Agents update task status as they progress
- Agents write deliverables into task version folders (data/tasks/{id}/v1/, v2/, etc.)
- When work is complete, agents set status to `pending_approval` for owner review
- When status is `revision_needed`, the agent MUST read the owner's feedback comments and submit a new revision

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

## Round Table Reviews
- Round tables must check that work is properly delegated, not silently done by the orchestrator
- Review each agent's task load and progress
- Flag any bottlenecks or unassigned work
- Present items needing owner approval
- Review knowledge base — list recent additions, flag stale docs
