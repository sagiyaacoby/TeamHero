# Agent Memory Templates

Reference file for memory structure. Agents read this when setting up or updating their memory files.

## Short Memory Template

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

## Long Memory Template

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

## Orchestrator Short Memory Template

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

## Orchestrator Long Memory Template

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

## Memory Update Rules

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

## Self-Promotion Rules

Agents are responsible for managing their own memory promotion. Do not wait for round tables.

### When to Promote (Short -> Long)

Promote to long-memory when **closing a task**:
- **Work log entry**: Add task ID, title, and one-line outcome to Completed Work Log
- **Lessons learned**: Any new insight about tools, platforms, or workflows
- **New platform/tool knowledge**: Access methods, authentication details, API quirks
- **Owner preference patterns**: Feedback themes from revision_needed cycles

### When to Prune Short Memory

Prune short-memory when **starting a new task**:
- Remove completed tasks older than 7 days from Recent Completions
- Remove resolved blockers from Blockers section
- Remove stale working context that no longer applies
- Keep Active Tasks current - remove any closed/cancelled tasks still listed

### Round Tables as Safety Net

Round tables review and catch anything agents missed - they are NOT the primary promotion path. During round tables:
- Verify short-memory matches actual task states
- Promote any completions agents failed to self-promote
- Consolidate long-memory if it is getting too large

### Applies to ALL Task Modes

These rules apply equally to:
- **Normal tasks**: Agent promotes when task reaches closed status
- **Direct execution**: Agent promotes after execution is verified
- **Autopilot tasks**: Agent promotes after auto-acceptance and completion
