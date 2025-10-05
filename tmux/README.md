# Tmux Session Management Scripts

This directory contains enhanced tmux session management scripts that follow bash and tmux best practices.

## Scripts Overview

### Core Scripts

- **`setup-main.sh`** - Creates/attaches to a general-purpose session
- **`setup-dev.sh`** - Creates/attaches to a development-focused session
- **`session-manager.sh`** - Comprehensive session manager with multiple options
- **`tmux-utils.sh`** - Shared utility functions (sourced by other scripts)

## Features

### Bash Best Practices

- ✅ `set -euo pipefail` for strict error handling
- ✅ Proper variable quoting and readonly declarations
- ✅ Comprehensive error handling with colored output
- ✅ Logging functionality with timestamps
- ✅ Input validation and dependency checking

### Tmux Best Practices

- ✅ Session existence checking before creation
- ✅ Proper session/window/pane management
- ✅ Custom status bar configuration
- ✅ Organized window layouts with meaningful names
- ✅ Split panes for enhanced workflow

### Enhanced Workflow Features

- 🎨 **Colored output** for better visibility
- 📝 **Logging** to `~/.tmux-session-*.log` files
- 🔧 **Error handling** with descriptive messages
- 🪟 **Creative window layouts** with split panes
- 🛠️ **Development tools** integration (git, docker, etc.)

## Usage

### Quick Start

```bash
# Start main session
./setup-main.sh

# Start development session
./setup-dev.sh

# Use comprehensive manager
./session-manager.sh main
./session-manager.sh dev
```

### Session Manager Options

```bash
# List all sessions
./session-manager.sh list

# Show session info
./session-manager.sh info main

# Kill specific session
./session-manager.sh kill main

# Kill all sessions
./session-manager.sh killall

# Show help
./session-manager.sh --help
```

## Session Layouts

### Main Session (`main`)

- **home** - Welcome screen with quick commands
- **docs** - Documentation workspace
- **projects** - Projects directory
- **monitor** - System monitoring (htop)
- **tools** - Development tools workspace

### Development Session (`dev`)

- **dev-home** - Development welcome screen
- **project** - Active project with split panes (left: code, right: logs)
- **git** - Git/version control workspace
- **docker** - Docker containers management
- **test** - Testing and CI workspace
- **db** - Database and backend tools
- **logs** - Logs and monitoring

## Configuration

### Customization

You can customize the scripts by modifying:
- Session names in the configuration section
- Window layouts and commands
- Status bar appearance
- Working directories

### Logging

All scripts log their activities to:
- `~/.tmux-session-main.log` (main session)
- `~/.tmux-session-dev.log` (dev session)
- `~/.tmux-session-manager.log` (session manager)

## Dependencies

- **tmux** - Terminal multiplexer (required)
- **bash** - Shell (version 4.0+ recommended)

## Error Handling

The scripts include comprehensive error handling:

- ✅ Tmux installation check
- ✅ Session creation validation
- ✅ Directory existence checks
- ✅ Command execution validation
- ✅ Colored error messages

## Examples

### Creating a Custom Session

```bash
# Example: Create a session for a specific project
SESSION_NAME="myproject"
./session-manager.sh main  # Use as template
# Then customize the windows as needed
```

### Integration with Other Tools

The scripts are designed to work with:

- Git workflows
- Docker containers
- Kubernetes clusters
- Database connections
- Log monitoring tools

## Troubleshooting

### Common Issues

1. **Permission denied**: Make sure scripts are executable (`chmod +x *.sh`)
2. **Tmux not found**: Install tmux (`brew install tmux` on macOS)
3. **Session already exists**: Use `./session-manager.sh list` to see active sessions

### Debug Mode

Enable verbose output:

```bash
./session-manager.sh --verbose main
```

## Contributing

When modifying these scripts:

1. Follow bash best practices
2. Maintain error handling
3. Update documentation
4. Test with different scenarios
5. Keep logging consistent
