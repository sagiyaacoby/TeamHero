# AI-Hero

Multi-agent orchestration platform powered by Claude CLI. Build and manage a team of AI agents from a single dashboard.

## Quick Install

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (check with `node -v`)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) — the AI backbone that powers your agents

Install Claude CLI if you don't have it:
```bash
npm install -g @anthropic-ai/claude-code
```

### Windows

```bash
git clone https://github.com/sagiyaacoby/TeamHero.git my-team
cd my-team
npm install
launch.bat
```

### Mac / Linux

```bash
git clone https://github.com/sagiyaacoby/TeamHero.git my-team
cd my-team
npm install
bash launch.sh
```

### Using npx (coming soon)

```bash
npx create-ai-hero my-team
cd my-team
npm start
```

## Getting Started

1. Run the install commands above
2. The dashboard opens automatically in your browser at `http://localhost:3777`
3. Complete the setup wizard — set your name, role, and goals
4. Go to the **Command Center** and ask the orchestrator to build a team
5. Create tasks, delegate work to agents, and review results

## What You Get

- **Dashboard** — manage agents, tasks, knowledge base, and media from a web portal
- **Command Center** — talk to your orchestrator agent directly via Claude CLI
- **Task System** — create, assign, review, and approve tasks with version tracking and progress logging
- **Knowledge Base** — promote research deliverables into a persistent, browsable library
- **Round Tables** — structured review sessions across all agents
- **Skills** — enable capabilities like browser control and screen recording
- **Agent Personalities** — each agent has its own personality, tone, rules, and memory

## Task Lifecycle

Tasks flow through a structured lifecycle:

```
draft → in_progress → pending_approval → approved / revision_needed / hold → done
```

- **draft** — task created, waiting to be picked up
- **in_progress** — agent is actively working on it
- **pending_approval** — work is done, waiting for your review
- **approved** — you approved it, agent begins execution
- **revision_needed** — needs changes based on your feedback
- **hold** — paused until you release it
- **done** — completed

## Project Structure

```
my-team/
├── agents/           # Agent definitions and memory
├── config/           # Team rules, security rules, system config
├── data/
│   ├── tasks/        # All tasks with version folders
│   ├── knowledge/    # Knowledge base documents
│   ├── round-tables/ # Round table summaries
│   └── media/        # Shared media library
├── portal/           # Dashboard web UI
├── profile/          # Owner profile
├── server.js         # API server
├── launch.bat        # Windows launcher
└── launch.sh         # Mac/Linux launcher
```

## API

The server runs at `http://localhost:3782` and provides a REST API:

| Endpoint | Description |
|---|---|
| `GET /api/agents` | List all agents |
| `POST /api/agents` | Create a new agent |
| `GET /api/tasks` | List all tasks |
| `POST /api/tasks` | Create a task |
| `POST /api/tasks/:id/progress` | Log progress on a task |
| `POST /api/tasks/:id/promote` | Promote task deliverable to Knowledge Base |
| `GET /api/knowledge` | List knowledge documents |
| `POST /api/knowledge` | Create a knowledge document |

## Troubleshooting

- **Port already in use** — The dashboard uses port 3777 and the API uses port 3782. Make sure these ports are free, or stop other processes using them.
- **Claude CLI not found** — Run `npm install -g @anthropic-ai/claude-code` and make sure it's on your PATH.
- **npm install fails** — Make sure you have Node.js 18+ installed. Run `node -v` to check.

## License

Apache-2.0
