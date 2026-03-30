# TeamHero

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Structured AI agent orchestration - manage agents like a real team.**

---

## The Story

I have been building software products for over 20 years. When I started using AI agents for my latest project, I ran into the same problem every developer hits - agents are powerful individually, but managing a team of them is chaos. No plans, no accountability, no structure.

So I built TeamHero to run my own agents the way I run real teams: with clear roles, plans before execution, tracked deliverables, and reviews. It worked. Really well.

I decided to give the core of my platform to the community. This is not a demo or a teaser - it is the full orchestration system, open source under MIT. My contribution to a community that has given me so much.

---

## What It Does

- **Dashboard** - Web UI to manage your entire agent team at a glance
- **Command Center** - Talk to your orchestrator agent through an integrated terminal
- **Task System** - Full lifecycle with plans, versions, approvals, and deliverable tracking
- **Agent Memory** - Every agent has persistent short and long-term memory across sessions
- **Knowledge Base** - Promote deliverables into a searchable, categorized library
- **Skills** - Optional integrations like browser automation and GitHub
- **Conflict Prevention** - File-scope declarations so agents never overwrite each other

---

## Who This Is For

Developers who work with Claude Code and want structure around their agents. If you believe in plans before execution, tracked deliverables, and accountability over "let it run and hope" - this is for you.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) - the AI backbone that powers your agents

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

The dashboard opens at `http://localhost:3777`. That is it.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

TeamHero is open source under the [MIT License](LICENSE).

The names "TeamHero" and "Kapow" are trademarks of Sagi Yaacoby. See [TRADEMARK.md](TRADEMARK.md) for details.
