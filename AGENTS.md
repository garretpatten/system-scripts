# Agent guidance

This repository holds **shell scripts** for macOS/Linux: **tmux** session
helpers under `tmux/`, **backup** utilities under `backups/`, and
**runtime configuration** helpers under `configuration/`. There is no
application runtime; changes are almost always Bash and documentation.

## Layout

- **`backups/`** — backup module (TypeScript under `src/`, Jest tests under
  `__tests__/`, thin shell wrappers per service)
  - **`src/`** — backup implementations (`local-backup.ts`,
    `gitlab-mirror.ts`, `notion-backup.ts`, `brave-bookmarks-backup.ts`,
    `chrome-bookmarks-backup.ts`, `obsidian-notes-backup.ts`,
    `google-calendar-backup.ts`, `google-tasks-backup.ts`), API clients, and
    shared helpers
    (`google-auth.ts` holds the shared Google OAuth 2.0 token refresh and the
    first-run interactive authorization flow)
  - **`code/`**, **`notion/`**, **`brave-bookmarks/`**, **`chrome-bookmarks/`**,
    **`obsidian-notes/`**, **`google-calendar/`**, **`google-tasks/`** — thin shell
    wrappers around
    the TypeScript entry points
  - **`run-all.sh`** — orchestrates all backups (thin wrapper around
    `src/run-all.ts`)
- **`configuration/`** — `runtime-configurations.sh`
- **`git-scripts/`** — `clone-all.sh`, `sync-all.sh`
- **`media-scripts/`** — `flatten-photos.sh`
- **`tmux/`** — `setup-main.sh`, `setup-dev.sh`, `session-manager.sh`;
  shared helpers in `tmux-utils.sh`
- **`.github/workflows/`** — PR quality checks (reusable workflow)

See [README.md](README.md), [backups/README.md](backups/README.md),
[configuration/README.md](configuration/README.md),
[git-scripts/README.md](git-scripts/README.md),
[media-scripts/README.md](media-scripts/README.md), and
[tmux/README.md](tmux/README.md) for usage and behavior.

## Conventions (shell)

- Prefer patterns already used in `tmux/`: strict mode (`set -euo pipefail`
  where appropriate), clear errors, colored messages, logging where the rest
  of the script logs.
- Quote expansions; avoid word-splitting and pathname surprises on user paths.
- `tmux-utils.sh` is **sourced** by other scripts—keep public function names
  and side effects consistent with callers.
- Assume **tmux** and **bash** (4.0+); do not introduce dependencies without
  a strong reason and documentation.

## Conventions (repo)

- **Prettier** is configured for formatting; `package.json` only lists Prettier
  as a dev dependency.
- CI runs **shellcheck**, **markdownlint**, **prettier**, **yamllint**, and
  other linters via a reusable workflow—scripts and markdown under linted
  paths should stay clean.

## What to do when editing

1. Read the target script and any scripts that `source` it before changing
   behavior.
2. Match naming, logging, and error style of neighboring code.
3. Run **shellcheck** on edited shell files and **prettier** on touched
   markdown/JSON/YAML when relevant.
4. Update the nearest `README.md` only when behavior, flags, or paths visible
   to users change.

## Out of scope

- Do not add unrelated languages, frameworks, or large refactors unless the
  user asks.
- Do not commit secrets, tokens, or machine-specific absolute paths meant for
  one developer only.
