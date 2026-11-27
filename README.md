# System Scripts

[![XERJ Corpus Hub contributor](https://hub.xerj.org/contributors/garretpatten/badge.svg)](https://hub.xerj.org/contributors/garretpatten)

[![License: MIT](https://img.shields.io/github/license/garretpatten/system-scripts?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/garretpatten/system-scripts/tests.yaml?branch=master&label=CI&logo=github&style=flat-square)](https://github.com/garretpatten/system-scripts/actions/workflows/tests.yaml)

A collection of system administration and development workflow scripts for
macOS/Linux environments. This repository is an **incubator**: it holds one-off
and underdeveloped concepts until they mature enough to graduate into their own
repository, at which point the in-repo module is replaced by a git submodule so
existing entry points keep working (see [Module lifecycle](#-module-lifecycle)).

## 🧬 Module Lifecycle

`system-scripts` incubates small, personal automation concepts. When a module
outgrows the incubator — its own test suite, its own release cadence, or simply
enough weight to deserve first-class treatment — it is broken out into a
dedicated repository, and the in-repo copy is replaced by a pinned git
submodule. Consumers keep the same entry points (npm scripts, shell wrappers,
cron jobs); development moves to the graduated repository.

| Module     | Status    | Graduated to                                                                             | Replaced by             |
| ---------- | --------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| `backups/` | Graduated | [garretpatten/backup-manager](https://github.com/garretpatten/backup-manager) (Nov 2026) | submodule at `backups/` |

Graduation is not removal: `npm run backup:all` and friends still work here,
executing inside the submodule. Bump the submodule pin deliberately, by pull
request, when you want newer backup releases.

## 📁 Project Structure

```text
system-scripts/
├── backups/              # SUBMODULE → garretpatten/backup-manager
│   │                     # (TypeScript backup implementations, tests,
│   │                     #  per-service shell wrappers, run-all.sh)
│   ├── src/              # TypeScript backup implementations (submodule)
│   ├── __tests__/        # Vitest unit tests (submodule)
│   ├── code/             # GitHub repository backup wrappers (submodule)
│   └── ...               # notion/, google-*/, bookmarks wrappers (submodule)
├── configuration/        # Machine-wide runtime tool settings
├── git-scripts/          # Git repository utilities
├── github/                # GitHub security and quality alert reporting
├── media-scripts/        # Photo library organization utilities
├── tmux/                  # Enhanced tmux session management
└── README.md            # This file
```

> Clone with `git clone --recurse-submodules`, or run
> `git submodule update --init --recursive` after a plain clone.

## 🔧 Scripts Overview

### 📦 Backups (`backups/` — submodule)

The backups module matured enough to graduate into its own repository:
**[garretpatten/backup-manager](https://github.com/garretpatten/backup-manager)**.
It is consumed here as a pinned git submodule at `backups/`, so every entry
point keeps working unchanged — `npm run backup:all` and the individual
`npm run backup:*` scripts execute inside the submodule, cron jobs and shell
wrappers behave exactly as before, and the same root `.env` still feeds them.

**What the module backs up** (see the
[backup-manager README](https://github.com/garretpatten/backup-manager#readme)
for full usage, configuration, and troubleshooting):

- Code repositories: local zipped clones of all non-archived GitHub repos,
  plus full GitLab mirrors with stale-mirror cleanup
- Notion workspaces as Markdown exports in dated zip archives
- Brave and Chrome bookmarks as Netscape HTML with dated JSON copies
- The Obsidian notes vault as a dated zip archive
- Google Calendar, Google Tasks, and Google Contacts as complete JSON
  exports via read-only OAuth scopes
- Google Photos Takeout archives, downloaded with resume support and merged
  into a flat, deduplicated local library

**Key Features:**

- ✅ Single command to run all backups (`npm run backup:all`)
- ✅ Credentials-aware orchestration (skips unconfigured backups with a
  warning)
- ✅ Comprehensive logging under `backups/logs/`
- ✅ Unit-tested TypeScript implementations

**Developing the backups:** changes belong in the `backup-manager`
repository now. Make them there, cut a release, then bump this repository's
submodule pin by pull request.

### 🛡️ GitHub Security Reports (`github/`)

Generates a dated report of open Dependabot and code scanning ("Security and
quality") alerts for every repository owned by your GitHub profile.

- `security-report.ts` - Iterates all owned repositories and reports alerts by
  severity and project

**Key Features:**

- ✅ **Owned Repository Discovery**: Lists all repos owned by the token account
  (public, private, and archived)
- ✅ **Dependabot Alerts**: Fetches every open dependency alert with CVE/GHSA
  details
- ✅ **Code Scanning Alerts**: Fetches every open code scanning alert with rule
  and location
- ✅ **Dated Report**: Writes `~/GitHub-Security-Report_YYYY-MM-DD.md`
- ✅ **Graceful Degradation**: Repositories without alerts enabled are listed
  as warnings instead of failing the run

### 🔧 Git Utilities (`git-scripts/`)

Utilities for managing multiple git repositories:

- `clone-all.sh` - Clone all non-archived GitHub repos into `~/Projects`
- `sync-all.sh` - Find all git repos in a path and update their default branch

**Typical workflow:**

```bash
./git-scripts/clone-all.sh              # clone missing repos
./git-scripts/sync-all.sh ~/Projects    # pull latest for all repos
./backups/code/code-backup-local.sh     # create a zip backup
```

**Key Features:**

- ✅ **GitHub Clone**: Fetches repo list from GitHub and clones missing projects
- ✅ **Automatic Detection**: Identifies default branch (main/master/HEAD)
- ✅ **Safe Updates**: Skips repositories with uncommitted changes
- ✅ **Recursive Discovery**: Finds all git repos within a given path
- ✅ **Clean Fetch**: Prunes deleted remote branches during fetch

### 📷 Media Utilities (`media-scripts/`)

Tools for organizing exported photo libraries:

- `flatten-photos.sh` - Flatten nested Google Photos takeout folders, remove
  empty directories, and delete supplemental `.json` metadata

**Typical workflow:**

```bash
./media-scripts/flatten-photos.sh --dry-run "$HOME/Pictures/Mobile Photos"
./media-scripts/flatten-photos.sh "$HOME/Pictures/Mobile Photos"
```

**Key Features:**

- ✅ Moves all nested files into a single target directory
- ✅ Skips duplicate content using SHA-256 hashes
- ✅ Resolves remaining filename collisions automatically
- ✅ Removes duplicate content already present in the target directory
- ✅ Removes empty subdirectories after flattening
- ✅ Deletes Google Photos supplemental `.json` metadata by default
- ✅ Dry-run mode for safe previews

### ⚙️ Runtime Configuration (`configuration/`)

Applies consistent package-manager cooldown settings on a machine:

- `runtime-configurations.sh` — 7-day minimum release age for Bundler, npm, pip,
  and uv

**Key Features:**

- ✅ Creates or updates config files under `$HOME`
- ✅ Only raises values below the target; never downgrades existing settings
- ✅ Writes `.bak` backups when updating files in place
- ✅ Idempotent: safe to run repeatedly

### 🖥️ Tmux Session Management (`tmux/`)

Enhanced tmux session management following bash and tmux best practices:

**Core Scripts:**

- `setup-main.sh` - General-purpose session with system monitoring
- `setup-dev.sh` - Development-focused session with project tools
- `session-manager.sh` - Comprehensive session manager
- `tmux-utils.sh` - Shared utility functions

**Key Features:**

- ✅ **Bash Best Practices**: Strict error handling, proper quoting, logging
- ✅ **Tmux Best Practices**: Session management, window organization, split panes
- ✅ **Creative Workflows**: Split panes, specialized windows, tool integration
- ✅ **Development Tools**: Git, Docker, testing, database, and monitoring windows
- ✅ **Error Handling**: Comprehensive validation and colored output
- ✅ **Logging**: Timestamped logs with session-specific files

## 🚀 Quick Start

### Running Backups

These commands delegate into the `backups/` submodule; configuration comes
from this repository's root `.env`, and logs land under `backups/logs/` as
before. Full documentation lives in the
[backup-manager README](https://github.com/garretpatten/backup-manager#readme).

```bash
# Run all backups (code-local, code-gitlab, notion, bookmarks, obsidian-notes,
# google-calendar, google-tasks, google-contacts)
npm run backup:all
npm run backups

# Run individual backups
npm run backup:code-local
npm run backup:code-gitlab
npm run backup:code-gitlab-cleanup
npm run backup:notion
npm run backup:brave-bookmarks
npm run backup:chrome-bookmarks
npm run backup:obsidian-notes
npm run backup:google-calendar
npm run backup:google-tasks
npm run backup:google-contacts
npm run backup:google-photos

# Run other repo scripts
npm run git:clone-all
npm run git:sync-all
npm run config:runtime
npm run tmux:setup-main
npm run tmux:setup-dev
npm run media:flatten-photos
npm run github:security-report
```

### Running Tests

```bash
npm test
```

## 📋 Session Layouts

### Main Session

- **btop** - System monitoring
- **home** - Welcome screen with quick commands (~ + neo)
- **projects** - Projects directory (~/Projects + lls)

### Development Session

- **btop** - System monitoring
- **home** - Welcome screen with quick commands (~ + neo)
- **projects** - Projects directory (~/Projects + lls)
- **git** - Git/version control workspace (~/Projects)

## 🛠️ Dependencies

- **bash** 4.0+ (for enhanced features)
- **tmux** (for session management)
- **git** (for code backup)
- **macOS/Linux** environment

## 📝 Logging

All scripts include comprehensive logging:

- `~/.tmux-session-*.log` - Tmux session logs
- `backups/logs/` - Backup operation logs (inside the submodule, gitignored
  there)
- `github/logs/` - GitHub security report logs
- Colored output for better visibility
- Timestamped entries with context

### Customizing Tmux Sessions

- Modify window layouts in the respective setup scripts
- Add custom commands and working directories
- Customize status bar appearance
- Add new specialized windows

### Backups

- Configure tokens and options in `.env` (backup-specific variables are
  documented in the submodule's `.env.example`)
- Adjust backup schedules and options
- Customize logging and reporting

## 📚 Documentation

- [Backups Documentation](https://github.com/garretpatten/backup-manager#readme)
  (the `backups/` submodule; also readable locally at `backups/README.md`)
- [Configuration Documentation](configuration/README.md)
- [GitHub Security Report Documentation](github/README.md)
- [Git Scripts Documentation](git-scripts/README.md)
- [Media Scripts Documentation](media-scripts/README.md)
- [Tmux Scripts Documentation](tmux/README.md)

## 🤝 Contributing

When modifying scripts:

1. Follow bash best practices (`set -euo pipefail`, proper quoting)
2. Maintain comprehensive error handling
3. Update documentation and logging
4. Test with different scenarios
5. Keep consistent code style

Backups changes are made in
[garretpatten/backup-manager](https://github.com/garretpatten/backup-manager);
bump this repository's submodule pin by pull request to consume a release.

## 📄 License

See [LICENSE](LICENSE) file for details.
