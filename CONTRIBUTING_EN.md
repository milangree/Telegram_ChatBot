# Contributing · Telegram ChatBot

This is the single entry point for contributions. Chinese version: [CONTRIBUTING.md](CONTRIBUTING.md).
Detailed process: [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md). AI assistant rules: [`AGENTS.md`](AGENTS.md).

## Three hard rules

1. **One PR, one thing.** No bug fix mixed with refactor, no feature mixed with reformatting. Template / CI / docs changes ship as their own PR.
2. **No unverified change.** The PR description must contain commands you actually ran plus output excerpts, and CI must be green.
3. **No secrets, no data.** Never commit `.env`, `data/*.db`, `dist/`, `node_modules/`, bot tokens, cookies, or user data.

## Setup

```bash
git clone https://github.com/milangree/Telegram_ChatBot.git
cd Telegram_ChatBot
npm ci
cp .env.example .env
bash scripts/install-git-hooks.sh   # enables .gitmessage template + commit-msg hook
npm run server          # http://localhost:3000 , health check /healthz
```

Node.js **22** (matches CI and the Docker image).

| Command | Purpose |
| --- | --- |
| `npm run build` | Vite build into `dist/` |
| `npm run lint` | ESLint over `src/ functions/ server/ scripts/ shared/` |
| `npm run lint:fix` | Auto-fix what is fixable |
| `npm run server` | Start the Node bridge server |
| `npm run server:dev` | Same, with `--watch` |
| `npm run stop` | Stop the local server |
| `npm run admin -- list` | Admin recovery CLI |

There is **no test script** in this repository; do not add a test gate to CI as part of an unrelated PR.

## Branches

`<type>/<short-description>` off the latest `main`, e.g. `feat/topic-archive`, `fix/d1-pagination-overflow`, `chore/issue-templates`.
No long-lived `develop`. `hotfix/*` only for production breakage. Never force-push a branch that is not yours.

## Commits

Conventional Commits via [`.gitmessage`](.gitmessage); the local check hook lives in `.githooks/commit-msg` (install with `bash scripts/install-git-hooks.sh`):

```
<type>(<scope>): imperative summary

Why: symptom / scenario / benefit.
Fix: root cause -> change -> blast radius.

Refs: Closes #123
Verified: npm run lint; npm run build; manual steps
```

`type`: `feat` `fix` `docs` `chore` `refactor` `perf` `style` `ci` `build` `revert`.
`scope`: `web` `api` `bot` `auth` `db` `server` `shared` `verify` `i18n` `docker` `ci` `docs` `deps`.
Breaking change: `feat(api)!: ...` plus a `BREAKING CHANGE:` line.

## Pull requests

Fill in [the PR template](.github/pull_request_template.md). Keep PRs small: **<= 400 changed lines and <= 15 files**; justify anything larger in the description (checked by `.github/workflows/pr-hygiene.yml`). Required check: `CI Quality Gate` (lint + build). At least one CODEOWNERS approval before merge.

Split into separate PRs when you have: feature + unrelated fix, refactor + behaviour change, template/CI changes, dependency bumps, or repo-wide formatting.

## Verify before you open the PR

```bash
npm run lint
npm run build
npm run server &
curl -fsS http://localhost:3000/healthz
npm run stop
```

Extra checks by area: storage (`ACTIVE_DB=kv|d1|hyperdrive`), bot flow (DM -> topic -> admin reply -> forward back), auth/TOTP, `openapi.yaml` for API changes, screenshots for UI, `docker compose up -d --build` for deployment changes.

## Docs to update

| Change | Also update |
| --- | --- |
| Env vars | `.env.example`, `docker-compose.yml`, README config section |
| API | `openapi.yaml` |
| User-facing feature | `README.md` **and** `README_EN.md` (keep them in sync) |
| Contribution process | `CONTRIBUTING.md`, this file, `docs/GITHUB_WORKFLOW.md` |
| Structure/layout | `AGENTS.md` module map, `docs/ARCHITECTURE.md` |

## Issues & security

Use the issue forms; blank issues are disabled. Usage questions belong in Discussions. Vulnerabilities go through [`docs/SECURITY_REPORTING.md`](docs/SECURITY_REPORTING.md), never a public issue.

## License

By contributing you agree your work is released under the [MIT License](LICENSE).
