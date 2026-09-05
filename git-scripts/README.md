# Git Scripts

Utilities for cloning and syncing multiple GitHub repositories into a local
projects directory.

## Workflow

A typical maintenance flow:

```bash
# 1. Clone any GitHub repos missing from ~/Projects
./git-scripts/clone-all.sh

# 2. Pull latest changes for every repo already on disk
./git-scripts/sync-all.sh

# 3. Create a local zip backup (see backups/)
./backups/code/code-backup-local.sh
```

---

## `clone-all.sh`

Fetches all non-archived GitHub repositories and clones any that are not
already present under `~/Projects` (or `$PROJECTS_DIR`).

### clone-all Features

- Lists non-archived repos via the GitHub API
- Skips repositories that already exist locally
- Checks out each new clone's default branch
- Logs progress and errors under `git-scripts/logs/`

### clone-all Requirements

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

### clone-all Usage

```bash
chmod +x git-scripts/clone-all.sh
./git-scripts/clone-all.sh
```

You can also pass a projects directory as an argument:

```bash
./git-scripts/clone-all.sh "$HOME/Projects"
```

Or via npm from the project root:

```bash
npm run git:clone-all
```

### clone-all Output

- **Cloned repositories**: `~/Projects/` (or `$PROJECTS_DIR`)
- **Logs**: `git-scripts/logs/clone-all-YYYYMMDD-HHMMSS.log`
- **Errors**: `git-scripts/logs/clone-all-errors-YYYYMMDD-HHMMSS.log`

---

## `sync-all.sh`

Finds all git repositories within a path, switches each to its default branch,
and pulls the latest changes.

### sync-all Features

- Recursive discovery of `.git` directories
- Automatic default branch detection (main/master/HEAD)
- Skips repos with uncommitted changes
- Prunes deleted remote branches during fetch

Can also be sourced by other scripts; `sync_repo` and `get_default_branch` are
available when sourced.

### sync-all Requirements

- `git`

### sync-all Usage

```bash
# Sync all repos under ~/Projects (default when no path is given)
./git-scripts/sync-all.sh
```

You can also pass a different directory to search:

```bash
./git-scripts/sync-all.sh ~/work-repos
```

Or via npm from the project root (defaults to ~/Projects):

```bash
npm run git:sync-all
```

---

## Related

- [Backups Documentation](../backups/README.md)
- [GitHub API Documentation](https://docs.github.com/en/rest)
