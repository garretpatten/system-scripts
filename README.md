# System Scripts

A collection of system administration and development workflow scripts for
macOS/Linux environments.

## 📁 Project Structure

```text
system-scripts/
├── backups/              # Repository, task, and workspace backups
│   ├── src/              # TypeScript backup implementations
│   ├── __tests__/        # Jest unit tests
│   ├── code/             # GitHub repository backup wrappers
│   ├── todoist/          # Todoist backup wrapper
│   ├── notion/           # Notion workspace Markdown export wrapper
│   └── run-all.sh        # Run all backups
├── configuration/        # Machine-wide runtime tool settings
├── git-scripts/          # Git repository utilities
├── media-scripts/        # Photo library organization utilities
├── tmux/                 # Enhanced tmux session management
└── README.md            # This file
```

## 🔧 Scripts Overview

### 📦 Backups (`backups/`)

Comprehensive backup module for code repositories, Todoist tasks, Notion
workspaces, and Brave browser bookmarks.

**Code backups:**

- Automated git operations (pull, push, status checking)
- Selective repository filtering
- Detailed logging and error handling
- Progress tracking and reporting

**Todoist backup:**

- Retrieves active tasks, projects, and labels via the Todoist REST API
- Creates timestamped zip archives

**Notion export:**

- Exports accessible pages and databases as Markdown
- Uses nested folders that mirror the workspace structure
- Creates timestamped zip archives

**Brave bookmarks export:**

- Converts Brave bookmarks to Netscape Bookmark File Format HTML
- Preserves folder hierarchy and basic metadata
- Creates dated HTML and JSON copies in the home directory

**Key Features:**

- ✅ Intelligent repository detection
- ✅ Git status validation before operations
- ✅ Comprehensive logging system
- ✅ Error handling and recovery
- ✅ Progress indicators and reporting
- ✅ Single command to run all backups

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

```bash
# Run all backups (code-local, code-gitlab, todoist, notion, brave-bookmarks)
npm run backup:all
npm run backups

# Run individual backups
npm run backup:code-local
npm run backup:code-gitlab
npm run backup:todoist
npm run backup:notion
npm run backup:brave-bookmarks
```

### Running Tests

```bash
npm test
```

## 📋 Session Layouts

### Main Session

- **home** - Welcome screen with quick commands
- **docs** - Documentation workspace
- **projects** - Projects directory
- **monitor** - System monitoring (htop)
- **tools** - Development tools workspace

### Development Session

- **dev-home** - Development welcome screen
- **project** - Active project with split panes (code + logs)
- **git** - Git/version control workspace
- **docker** - Docker containers management
- **test** - Testing and CI workspace
- **db** - Database and backend tools
- **logs** - Logs and monitoring

## 🛠️ Dependencies

- **bash** 4.0+ (for enhanced features)
- **tmux** (for session management)
- **git** (for code backup)
- **macOS/Linux** environment

## 📝 Logging

All scripts include comprehensive logging:

- `~/.tmux-session-*.log` - Tmux session logs
- `backups/logs/` - Backup operation logs
- Colored output for better visibility
- Timestamped entries with context

### Customizing Tmux Sessions

- Modify window layouts in the respective setup scripts
- Add custom commands and working directories
- Customize status bar appearance
- Add new specialized windows

### Backups

- Configure tokens and options in `.env`
- Adjust backup schedules and options
- Customize logging and reporting

## 📚 Documentation

- [Backups Documentation](backups/README.md)
- [Configuration Documentation](configuration/README.md)
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

## 📄 License

See [LICENSE](LICENSE) file for details.
