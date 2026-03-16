# AI-Hero

Multi-agent orchestration platform powered by Claude CLI. Build and manage a team of AI agents from a single dashboard.

## Install

**Windows:**
```
git clone https://github.com/sagiyaacoby/TeamHero.git my-team && cd my-team && npm install && launch.bat
```

**Mac / Linux:**
```
git clone https://github.com/sagiyaacoby/TeamHero.git my-team && cd my-team && npm install && bash launch.sh
```

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (for the Command Center)

Claude CLI install:
```
npm install -g @anthropic-ai/claude-code
```

## What You Get

- **Dashboard** — manage agents, tasks, knowledge base, and media from a web portal
- **Command Center** — talk to your orchestrator agent directly via Claude CLI
- **Task System** — create, assign, review, approve tasks with version tracking
- **Knowledge Base** — promote research deliverables into a persistent, browsable library
- **Round Tables** — structured review sessions across all agents
- **Skills** — enable capabilities like browser control and screen recording

## How It Works

1. Run the install line above
2. The dashboard opens in your browser at `http://localhost:3777`
3. Complete the setup wizard (name, profile, team)
4. Go to the **Command Center** and ask your orchestrator to build a team
5. Create tasks, delegate work, review results

## License

Apache-2.0
