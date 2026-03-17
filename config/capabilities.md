# System Capabilities

Current features available to the orchestrator and agents.

## Task Features
- **Tags**: Tasks support `tags[]` array. Use tags to group tasks by campaign, topic, or type. Include tags when creating tasks: `{"tags":["launch","reddit"]}`. Dashboard has tag filter bar with multi-select.
- **Due dates**: Tasks support optional `dueDate` field (ISO date string). Set when time-sensitive: `{"dueDate":"2026-03-20"}`. Overdue tasks are highlighted in the dashboard.
- **Timestamps**: Tasks have `createdAt` and `updatedAt` fields. Shown as relative time in dashboard.
- **Subtasks**: Unlimited nesting depth. Create via `POST /api/tasks/{parentId}/subtasks`. Dependencies via `dependsOn[]`.
- **Autopilot**: Tasks with `autopilot: true` skip owner review. Agent delivers, orchestrator auto-accepts and closes.
- **Views**: Dashboard offers List, Flow (dependency graph), and Tree (hierarchy) views.
- **Filters**: Dashboard defaults to Pending view. "Active" filter shows all non-closed tasks. Closed tasks only visible via Closed filter.

## Credentials & Secrets
- **Secrets vault**: AES-256-GCM encrypted. Stores API keys and tokens as env vars. Manage via Settings > Secrets & API Keys.
- **Credentials manager**: Stores website login credentials (service name, username, password). Injected as `{SERVICE}_USERNAME` and `{SERVICE}_PASSWORD` env vars. Manage via Settings > Credentials.
- Agents access secrets/credentials as environment variables. Never expose values in output.

## Dashboard Views
- **Autopilot view**: Dedicated nav item for managing scheduled autopilot tasks with intervals.
- **Flow view**: Visual node graph showing task dependencies and parent/child relationships.
- **Tree view**: Collapsible hierarchy for nested task structures.

## Image Sharing
- **Paste Image** button below the CLI (or Ctrl+V): Owner pastes a screenshot from clipboard, saved to `temp/clipboard/clip-{timestamp}.png`. The absolute file path is automatically sent to the CLI as a message so the orchestrator can read the image immediately.
- **Attach Image** in task detail: Owner pastes an image directly into task feedback, saved to `data/tasks/{taskId}/images/img-{timestamp}.png`. Path is auto-appended to the feedback text.
- When the owner shares a screenshot, use the Read tool on the absolute path to view the image and understand the context.

## Media & Content
- Media library at `data/media/` with thumbnail previews.
- Social images stored in `data/media/social-images/`.
- Remotion video skill available for programmatic video creation (`remotion/` folder).

## Skills System
- Skills are optional integrations (Trello, Remotion, etc.) managed via Settings > Skills.
- Each skill can have required secrets/config. Install/uninstall via dashboard.
