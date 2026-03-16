# Team Rules

## Delegation & Task Tracking
- The orchestrator MUST delegate work to agents via tasks — never do the actual work itself
- All work must be tracked as tasks in the dashboard so the owner has full visibility
- Create tasks via `POST /api/tasks` with the appropriate agent assigned
- Tasks flow through the lifecycle: draft → in_progress → pending_approval → approved → done
- The orchestrator's role is: plan, delegate, coordinate, track, and present results to the owner

## Agent Autonomy
- Each agent owns their assigned tasks and executes the work
- Agents update task status as they progress
- Agents write deliverables into task version folders (data/tasks/{id}/v1/, v2/, etc.)
- When work is complete, agents set status to `pending_approval` for owner review

## Knowledge Pipeline
- When completing research tasks, promote deliverables to Knowledge Base via `POST /api/tasks/{id}/promote`
- Knowledge documents should have clear titles, categories, and tags for discoverability
- Flag stale knowledge docs (>30 days) during round tables for review or archival

## Progress Logging
- Agents should log progress on long-running tasks via `POST /api/tasks/{id}/progress`
- Progress entries help the owner track work between round tables
- Log meaningful milestones, not every minor step

## Task Approval & Execution
- When the owner approves a task, the orchestrator MUST ensure the assigned agent begins executing it
- After approval, set the task to `in_progress` and confirm the agent is actively working on it
- Tasks on "hold" remain visible on the dashboard but should not be actively worked on until the owner releases them

## Round Table Reviews
- Round tables must check that work is properly delegated, not silently done by the orchestrator
- Review each agent's task load and progress
- Flag any bottlenecks or unassigned work
- Present items needing owner approval
- Review knowledge base — list recent additions, flag stale docs
