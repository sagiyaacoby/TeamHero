# TeamHero

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Build and manage a team of AI agents from a single dashboard.**

TeamHero is an open-source, local-first multi-agent orchestration platform powered by Claude CLI. Create specialized AI agents, assign tasks, review deliverables, and coordinate work — all from a web dashboard running on your machine.

No cloud. No subscriptions. Your data stays local.

<!-- TODO: Add screenshot of dashboard here -->
<!-- ![TeamHero Dashboard](docs/screenshot.png) -->

---

## Why TeamHero?

| | TeamHero | CrewAI | LangGraph | AutoGen |
|---|---|---|---|---|
| **License** | MIT | MIT | MIT | MIT |
| **Local-first** | Yes | Cloud-focused | Cloud-focused | Local |
| **Dashboard** | Built-in web UI | Paid (cloud) | None | None |
| **Setup** | `npm install` + go | Python + config | Python + config | Python + config |
| **Agent memory** | Built-in per-agent | Cloud only | Manual | Manual |
| **Task management** | Built-in lifecycle | API only | None | None |
| **Knowledge base** | Built-in | None | None | None |
| **Price** | Free | Free tier, then $99/mo+ | Free tier, then paid | Free |

TeamHero gives you a complete agent management platform out of the box — dashboard, task tracking, knowledge base, media library, and round table reviews — with zero configuration.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) — the AI backbone that powers your agents

```bash
npm install -g @anthropic-ai/claude-code
```

### Install

```bash
git clone https://github.com/sagiyaacoby/TeamHero.git my-team
cd my-team
npm install
```

### Launch

**Windows:**
```bash
launch.bat
```

**Mac / Linux:**
```bash
bash launch.sh
```

The dashboard opens at `http://localhost:3777`. That's it.

---

## Getting Started

1. Complete the setup wizard — set your name, role, and goals
2. Go to the **Command Center** and ask the orchestrator to build a team
   > "Build me a team with a Content Writer, a Researcher, and a Developer"
3. Create tasks and assign them to agents
4. Review deliverables and approve or request revisions
5. Promote finished work to the Knowledge Base

---

## Features

### Dashboard
Web-based portal to manage your entire agent team. View agent status, tasks, and deliverables at a glance.

### Command Center
Talk directly to your orchestrator agent via an integrated terminal. The orchestrator coordinates all other agents.

### Task System
Full task lifecycle with version tracking:
```
planning -> working -> pending_approval -> working (accept) -> done -> closed (auto)
```
Each task tracks versions, deliverables, attachments, and owner feedback.

### Agent Personalities
Every agent has its own name, role, personality traits, tone, rules, and persistent memory. Agents remember context across sessions.

### Knowledge Base
Promote task deliverables into a searchable, categorized knowledge library. Tag, filter, and browse research and outputs.

### Media Library
Shared media storage with thumbnail previews. Upload images, documents, and files for agents to reference.

### Round Tables
Structured review sessions across all agents. Get a status report, surface blockers, and make decisions.

### Skills
Enable optional capabilities like browser automation (Playwright) and screen recording.

---

## Architecture

TeamHero is intentionally simple:

- **Server:** Single `server.js` file using Node's built-in `http` module. No Express, no frameworks.
- **Portal:** Vanilla HTML, CSS, and JavaScript. No React, no build step, no bundlers.
- **AI:** Claude CLI runs as a subprocess. Agents are Claude sessions with custom system prompts.
- **Data:** JSON files on disk. No database required.

```
TeamHero/
├── server.js           # API server
├── portal/             # Dashboard (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── agents/             # Agent definitions and memory
├── config/             # Team rules, security rules
├── data/
│   ├── tasks/          # Tasks with version folders
│   ├── knowledge/      # Knowledge base documents
│   ├── round-tables/   # Round table summaries
│   └── media/          # Shared media library
├── profile/            # Owner profile
├── launch.bat          # Windows launcher
└── launch.sh           # Mac/Linux launcher
```

---

## API

The server exposes a REST API at `http://localhost:3782`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/agents` | GET | List all agents |
| `/api/agents` | POST | Create a new agent |
| `/api/agents/:id` | PUT | Update an agent |
| `/api/tasks` | GET | List all tasks |
| `/api/tasks` | POST | Create a task |
| `/api/tasks/:id` | PUT | Update a task |
| `/api/tasks/:id/versions` | GET | Get task version history |
| `/api/tasks/:id/promote` | POST | Promote deliverable to Knowledge Base |
| `/api/knowledge` | GET | List knowledge documents |
| `/api/knowledge` | POST | Create a knowledge document |
| `/api/profile` | PUT | Update owner profile |

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Whether it's a bug fix, new feature, documentation improvement, or agent template — we'd love your help.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Port already in use | Dashboard uses 3777, API uses 3782. Free these ports or stop conflicting processes. |
| Claude CLI not found | Run `npm install -g @anthropic-ai/claude-code` and ensure it's on your PATH. |
| npm install fails | Make sure you have Node.js 18+. Check with `node -v`. |
| Dashboard won't load | Check that `server.js` is running. Look at the terminal for errors. |

---

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TeamHero is open source software released under the [MIT License](LICENSE).

You are free to use, modify, and distribute the code. However, the names "TeamHero" and "Kapow" are trademarks of Sagi Yaacoby. Forked or modified versions must be renamed and may not use the TeamHero or Kapow names or logos.

See [TRADEMARK.md](TRADEMARK.md) for the full trademark policy.
