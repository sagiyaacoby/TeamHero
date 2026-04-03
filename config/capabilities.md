# System Capabilities

## Task Features
- **Tags**: `tags[]` array for grouping by campaign/topic/type. Example: `{"tags":["launch","reddit"]}`. Dashboard has tag filter with multi-select.
- **Due dates**: Optional `dueDate` (ISO date string). Overdue tasks highlighted in dashboard.
- **Timestamps**: `createdAt`/`updatedAt` fields, shown as relative time.
- **Views**: List, Flow (dependency graph), and Tree (hierarchy).
- **Filters**: Defaults to Pending view. "Active" = all non-closed. Closed tasks only via Closed filter.

## Credentials & Secrets
- **Secrets vault**: AES-256-GCM encrypted, stored as env vars. Manage via Settings > Secrets & API Keys.
- **Credentials manager**: Website logins injected as `{SERVICE}_USERNAME`/`{SERVICE}_PASSWORD` env vars. Manage via Settings > Credentials.
- Agents access secrets/credentials as environment variables. Never expose values.

## Command Center
- **Ctrl+V**: Paste into CLI | **Ctrl+C**: Copy from CLI | **Ctrl+G**: External editor for multiline input
- **Attach Image**: Paste image into task feedback, saved to `data/tasks/{taskId}/images/img-{timestamp}.png`
- When owner shares a screenshot, use Read tool on the absolute path to view it.

## Media & Content
- Media library at `data/media/` with thumbnails. Social images in `data/media/social-images/`.
- Remotion video skill available (`remotion/` folder).

## Agent Memory
- API: `GET/PUT /api/agents/{id}/memory/short` or `/long` with `{"content":"..."}`
- Templates: see `config/memory-templates.md`

## Skills System
- Optional integrations (Trello, Remotion, etc.) via Settings > Skills. Each skill can require secrets/config.
