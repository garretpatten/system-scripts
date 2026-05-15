# Agent guidance

This repository holds **shell scripts** for macOS/Linux: **tmux** session helpers under `tmux/` and **git backup** utilities under `code-backup/`. There is no application runtime; changes are almost always Bash and documentation.

## Layout

| Path                 | Role                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `tmux/`              | `setup-main.sh`, `setup-dev.sh`, `session-manager.sh`; shared helpers in `tmux-utils.sh` |
| `code-backup/`       | `code-backup-local.sh`, `code-backup-gitlab.sh`                                          |
| `.github/workflows/` | PR quality checks (reusable workflow)                                                    |

See [README.md](README.md), [tmux/README.md](tmux/README.md), and [code-backup/README.md](code-backup/README.md) for usage and behavior.

## Conventions (shell)

- Prefer patterns already used in `tmux/`: strict mode (`set -euo pipefail` where appropriate), clear errors, colored messages, logging where the rest of the script logs.
- Quote expansions; avoid word-splitting and pathname surprises on user paths.
- `tmux-utils.sh` is **sourced** by other scripts—keep public function names and side effects consistent with callers.
- Assume **tmux** and **bash** (4.0+); do not introduce dependencies without a strong reason and documentation.

## Conventions (repo)

- **Prettier** is configured for formatting; `package.json` only lists Prettier as a dev dependency.
- CI runs **shellcheck**, **markdownlint**, **prettier**, **yamllint**, and other linters via a reusable workflow—scripts and markdown under linted paths should stay clean.

## What to do when editing

1. Read the target script and any scripts that `source` it before changing behavior.
2. Match naming, logging, and error style of neighboring code.
3. Run **shellcheck** on edited shell files and **prettier** on touched markdown/JSON/YAML when relevant.
4. Update the nearest `README.md` only when behavior, flags, or paths visible to users change.

## Out of scope

- Do not add unrelated languages, frameworks, or large refactors unless the user asks.
- Do not commit secrets, tokens, or machine-specific absolute paths meant for one developer only.
