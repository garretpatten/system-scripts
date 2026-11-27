# Agent guidance

This repository holds **shell scripts** for macOS/Linux: **tmux** session
helpers under `tmux/`, **backup** utilities under the `backups/` git submodule
([backup-manager](https://github.com/garretpatten/backup-manager)), and
**runtime configuration** helpers under `configuration/`. There is no
application runtime; changes are almost always Bash and documentation, plus
the TypeScript `github/` module.

## Repository standards

[garretpatten/github-standards](https://github.com/garretpatten/github-standards) is the
**canonical source of truth** for how every `garretpatten` repository must be structured
and maintained: license, security policy, contributing, community files, README
branding, CODEOWNERS, branch protection, pull requests, signed commits, Dependabot,
dependency hygiene, secret hygiene, workflow permissions, action pinning, repository
metadata, CI and quality, and exceptions.

- **Before starting any task**, read the current standards from the source of truth
  rather than from memory or a cached copy — they change over time. The standards index
  is at <https://github.com/garretpatten/github-standards#standards-files>; fetch raw
  files from
  `https://raw.githubusercontent.com/garretpatten/github-standards/master/<standard>.md`
  (via web fetch, `curl`, or `gh api`) and read every standard relevant to the task.
- **While working**, apply the standards to every change: workflows, dependency files,
  community files, repository metadata, and commit practices must conform to the
  standards as they exist at the time of the change.
- **When you detect drift** — this repository lagging behind a standard that changed —
  bring the repository back in line as part of normal work and call it out in your
  summary. If an update would be large or ambiguous, propose it instead of applying it
  silently.
- **Before finishing**, confirm the work satisfies the
  [verification](https://github.com/garretpatten/github-standards/blob/master/verification.md)
  standard and that local checks pass.
- For a full compliance review, use the `github-audit` skill, which audits a repository
  against these standards and reports numbered findings.

## Layout

- **`backups/`** — **git submodule** pointing at
  [garretpatten/backup-manager](https://github.com/garretpatten/backup-manager)
  (pinned; TypeScript backup implementations under `src/`, Vitest tests under
  `__tests__/`, thin shell wrappers per service, `run-all.sh` orchestrator).
  The backups module graduated from this repository in November 2026;
  development happens in `backup-manager`, and this repository consumes
  releases by bumping the submodule pin in a pull request.
  - The `npm run backup:*` scripts in this repository delegate into the
    submodule; configuration still comes from this repository's root `.env`
    and logs still land under `backups/logs/`.
- **`configuration/`** — `runtime-configurations.sh`
- **`git-scripts/`** — `clone-all.sh`, `sync-all.sh`
- **`github/`** — GitHub security report (TypeScript under `src/`, Vitest tests
  under `__tests__/`, `npm run github:security-report`; reuses shared runtime
  helpers from the `backups/` submodule's `src/`)
- **`media-scripts/`** — `flatten-photos.sh`
- **`tmux/`** — `setup-main.sh`, `setup-dev.sh`, `session-manager.sh`;
  shared helpers in `tmux-utils.sh`
- **`.github/workflows/`** — PR quality checks (reusable workflow)

See [README.md](README.md),
[backup-manager's README](https://github.com/garretpatten/backup-manager#readme)
(readable locally at [backups/README.md](backups/README.md)),
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

## GitHub Actions

Whenever a GitHub workflow is added, all GitHub Action pins in that workflow
should be updated to point to the full-length commit SHA of the most recent
release.
