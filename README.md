# TeamHero

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Manage AI agent teams with real project management discipline.**

---

## Why This Exists

We have decades of tools for managing people - project boards, task trackers, review workflows. But when it comes to AI agents, there is nothing like that. You spin up agents and hope for the best. No plans, no accountability, no structure. I hit this wall while working on my own projects and could not find anything that treated agent management the way we treat people management.

So I built it. The result became [Kapow](https://gokapow.com) - a managed AI agent platform for businesses. The feedback was immediate. People got it. The idea that agents should work in a structured team with real project management discipline - not just run loose - resonated with developers and business owners alike.

That response made something clear: the need for structured agent orchestration goes way beyond one product. As an entrepreneur, I decided the best thing I could do was release the core architecture as open source to share the unique methodology of running agents at scale. TeamHero is that release - the full orchestration platform under MIT license, no restrictions, nothing held back. My contribution to the open source community.

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

## What Makes It Different

Most agent frameworks focus on creating agents. TeamHero focuses on managing them. The difference matters when you have multiple agents working on the same project - you need plans before execution, tracked deliverables, conflict prevention, and a single source of truth for what is happening across your team.

TeamHero brings real project management to AI agents. Every task goes through plan, review, execute, and deliver. Every agent has persistent memory. Every file touched is declared upfront so agents do not overwrite each other. It is the discipline that makes agents actually useful at scale - not throwing more of them at the problem.

---

## Who This Is For

Developers who work with Claude Code and want structure around their agents. If you believe in plans before execution, tracked deliverables, and a disciplined approach over "let it run and hope" - this is for you.

This is a builder platform. You set up your agents, define their roles, and manage your team through the orchestrator. It requires comfort with CLI and Node.js.

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

The dashboard opens at `http://localhost:3777`. From there, open the Command Center and start building your team.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

TeamHero is open source under the [MIT License](LICENSE).

The names "TeamHero" and "Kapow" are trademarks of Sagi Yaacoby. See [TRADEMARK.md](TRADEMARK.md) for details.
