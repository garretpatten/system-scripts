# System Scripts

A collection of system administration and development workflow scripts for macOS/Linux environments.

## 📁 Project Structure

```text
system-scripts/
├── code-backup/          # Repository backup and management
├── tmux/                 # Enhanced tmux session management
└── README.md            # This file
```

## 🔧 Scripts Overview

### 📦 Code Backup (`code-backup/`)

Comprehensive repository backup and management system with:

- Automated git operations (pull, push, status checking)
- Selective repository filtering
- Detailed logging and error handling
- Progress tracking and reporting

**Key Features:**

- ✅ Intelligent repository detection
- ✅ Git status validation before operations
- ✅ Comprehensive logging system
- ✅ Error handling and recovery
- ✅ Progress indicators and reporting

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

### Tmux Sessions

```bash
# Start main session (general purpose)
./tmux/setup-main.sh

# Start development session
./tmux/setup-dev.sh

# Use comprehensive manager
./tmux/session-manager.sh main
./tmux/session-manager.sh dev
```

### Code Backup

```bash
# Run backup for all repositories
./code-backup/code-backup.sh

# Run with specific options
./code-backup/code-backup.sh --help
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
- `code-backup/logs/` - Backup operation logs
- Colored output for better visibility
- Timestamped entries with context

## 🔧 Customization

### Tmux Sessions

- Modify window layouts in the respective setup scripts
- Add custom commands and working directories
- Customize status bar appearance
- Add new specialized windows

### Code Backup

- Configure repository paths and filters
- Adjust backup schedules and options
- Customize logging and reporting

## 📚 Documentation

- [Tmux Scripts Documentation](tmux/README.md)
- [Code Backup Documentation](code-backup/README.md)

## 🤝 Contributing

When modifying scripts:

1. Follow bash best practices (`set -euo pipefail`, proper quoting)
2. Maintain comprehensive error handling
3. Update documentation and logging
4. Test with different scenarios
5. Keep consistent code style

## 📄 License

See [LICENSE](LICENSE) file for details.
