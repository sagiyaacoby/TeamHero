# Contributing to TeamHero

Thanks for your interest in contributing to TeamHero! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/TeamHero.git
   cd TeamHero
   npm install
   ```
3. Create a branch for your work:
   ```bash
   git checkout -b my-feature
   ```
4. Make your changes
5. Test locally by running `launch.bat` (Windows) or `bash launch.sh` (Mac/Linux)
6. Commit and push to your fork
7. Open a Pull Request against the `main` branch

## What Can I Work On?

- Check [open issues](https://github.com/sagiyaacoby/TeamHero/issues) for bugs and feature requests
- Issues labeled `good first issue` are great starting points
- If you have an idea not covered by an existing issue, open one first to discuss

## Project Structure

```
TeamHero/
├── server.js         # API server (Node.js, no frameworks)
├── portal/           # Dashboard web UI (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── agents/           # Agent definitions and memory
├── config/           # Team rules, security rules, system config
├── data/             # Tasks, knowledge base, media, round tables
├── profile/          # Owner profile
├── launch.bat        # Windows launcher
└── launch.sh         # Mac/Linux launcher
```

## Guidelines

- **Keep it simple.** TeamHero uses vanilla JS with zero frontend frameworks. No build step. Keep it that way.
- **No breaking changes** to the API without discussion first.
- **Test locally** before submitting a PR. Make sure the dashboard loads and basic operations work.
- **One PR per feature/fix.** Don't bundle unrelated changes.
- **Write clear commit messages.** Describe what changed and why.

## Code Style

- Vanilla JavaScript (ES6+). No TypeScript, no JSX, no bundlers.
- Server is a single `server.js` file using Node's built-in `http` module.
- Portal uses plain HTML, CSS, and JS. No build tools.
- Prefer readability over cleverness.

## Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your OS and Node.js version

## Feature Requests

Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
