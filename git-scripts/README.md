# Git Scripts

Utilities for cloning and syncing multiple GitHub repositories into a local
projects directory.

## Workflow

A typical maintenance flow:

```bash
# 1. Clone any GitHub repos missing from ~/Projects
./git-scripts/clone-all.sh

# 2. Pull latest changes for every repo already on disk
./git-scripts/sync-all.sh ~/Projects

# 3. Create a local zip backup (see code-backup/)
./code-backup/code-backup-local.sh
```

---

## `clone-all.sh`

Fetches all non-archived GitHub repositories and clones any that are not
already present under `~/Projects` (or `$PROJECTS_DIR`).

### Features

- Lists non-archived repos via the GitHub API
- Skips repositories that already exist locally
- Checks out each new clone's default branch
- Logs progress and errors under `git-scripts/logs/`

### Requirements

- `git`, `curl`, `jq`

### Authentication

For private repositories, set a GitHub Personal Access Token:

```bash
export GITHUB_TOKEN="your_token_here"
```

Optional environment variables:

```bash
export GITHUB_USERNAME="your-username"  # Auto-detected if token provided
export PROJECTS_DIR="$HOME/Projects"    # Default: ~/Projects
export USE_GITHUB_SSH="true"            # Use SSH instead of HTTPS (default: false)
```

### Usage

```bash
chmod +x git-scripts/clone-all.sh
./git-scripts/clone-all.sh
```

### Output

- **Cloned repositories**: `~/Projects/` (or `$PROJECTS_DIR`)
- **Logs**: `git-scripts/logs/clone-all-YYYYMMDD-HHMMSS.log`
- **Errors**: `git-scripts/logs/clone-all-errors-YYYYMMDD-HHMMSS.log`

---

## `sync-all.sh`

Finds all git repositories within a path, switches each to its default branch,
and pulls the latest changes.

### Features

- Recursive discovery of `.git` directories
- Automatic default branch detection (main/master/HEAD)
- Skips repos with uncommitted changes
- Prunes deleted remote branches during fetch

Can also be sourced by other scripts; `sync_repo` and `get_default_branch` are
available when sourced.

### Requirements

- `git`

### Usage

```bash
# Sync all repos under ~/Projects (default path is current directory)
./git-scripts/sync-all.sh ~/Projects
```

---

## Related

- [Code Backup Documentation](../code-backup/README.md)
- [GitHub API Documentation](https://docs.github.com/en/rest)
