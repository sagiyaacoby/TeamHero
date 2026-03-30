# Contributing to TeamHero

Thanks for your interest in contributing to TeamHero! This guide covers everything you need to get started.

## Running Locally

1. Fork and clone:
   ```bash
   git clone https://github.com/YOUR-USERNAME/TeamHero.git
   cd TeamHero
   npm install
   ```

2. Start the server:
   ```bash
   # Windows
   launch.bat

   # Mac/Linux
   bash launch.sh
   ```

3. The dashboard opens at `http://localhost:3796`. The server uses Node's built-in `http` module with no external framework - just `npm install` and go.

4. The API runs on the same port. Try `curl http://localhost:3796/api/health` to verify everything is working.

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

## What Contributions Are Welcome

- **Bug fixes** - found something broken? Fix it and send a PR
- **Documentation** - better examples, clearer explanations, typo fixes
- **Agent templates** - new agent personalities and roles for different team types
- **Issue triage** - reproducing bugs, adding details to reports
- **Feature ideas** - open an issue to discuss before building
- **Translations** - help make TeamHero accessible in more languages
- **Tests** - we'd love more test coverage

## Pull Request Process

1. Create a branch from `main` for your work
2. Make your changes - keep PRs focused on one thing
3. Test locally: make sure the dashboard loads and basic operations work
4. Commit with clear messages describing what changed and why
5. Open a PR against the `main` branch

### What to expect after submitting

- We aim to review PRs within **48-72 hours**
- We'll provide constructive feedback if changes are needed
- Once approved, we'll merge and include it in the next release

## DCO (Developer Certificate of Origin)

We use the DCO instead of a CLA. This means you certify that you wrote the code (or have the right to submit it) by adding a sign-off to your commits:

```bash
git commit -s -m "Fix task status transition bug"
```

This adds a `Signed-off-by` line to your commit. That's it - no legal forms to sign.

## Code Style

- Vanilla JavaScript (ES6+). No TypeScript, no JSX, no bundlers.
- Server is a single `server.js` file using Node's built-in `http` module.
- Portal uses plain HTML, CSS, and JS. No build tools.
- Prefer readability over cleverness.
- Keep it simple - zero frontend frameworks is intentional.

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

## Security Issues

Please report security vulnerabilities privately - see [SECURITY.md](SECURITY.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
