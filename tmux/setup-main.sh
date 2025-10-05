#!/bin/bash

# Main tmux session setup script
# Creates or reattaches to a main development session with organized windows

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Configuration
readonly SESSION_NAME='main'
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOG_FILE="${HOME}/.tmux-session-${SESSION_NAME}.log"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*" | tee -a "${LOG_FILE}"
}

# Error handling
error_exit() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

# Check if tmux is installed
if ! command -v tmux >/dev/null 2>&1; then
    error_exit "tmux is not installed. Please install tmux first."
fi

# Function to create new session with windows
create_session() {
    log "Creating new tmux session: ${SESSION_NAME}"

    # Create detached session
    if ! tmux new-session -d -s "${SESSION_NAME}" 2>/dev/null; then
        error_exit "Failed to create tmux session: ${SESSION_NAME}"
    fi

    # Configure session options
    tmux set-option -t "${SESSION_NAME}" -g status on
    tmux set-option -t "${SESSION_NAME}" -g status-interval 1
    tmux set-option -t "${SESSION_NAME}" -g status-left-length 20
    tmux set-option -t "${SESSION_NAME}" -g status-right-length 50
    tmux set-option -t "${SESSION_NAME}" -g status-left '#[fg=green]#S #[fg=white]| '
    tmux set-option -t "${SESSION_NAME}" -g status-right '#[fg=yellow]%Y-%m-%d %H:%M:%S'

    # Window 0: Home/Overview
    tmux rename-window -t "${SESSION_NAME}:0" 'home'
    tmux send-keys -t "${SESSION_NAME}:0" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:0" 'echo "Welcome to Main Session!"' C-m
    tmux send-keys -t "${SESSION_NAME}:0" 'echo "Available commands: htop, nvtop, neofetch"' C-m
    tmux send-keys -t "${SESSION_NAME}:0" 'pwd' C-m

    # Window 1: Documentation
    tmux new-window -t "${SESSION_NAME}" -n 'docs'
    tmux send-keys -t "${SESSION_NAME}:1" 'cd "${HOME}/Projects/documentation" 2>/dev/null || cd "${HOME}/Documents" 2>/dev/null || cd "${HOME}"' C-m
    tmux send-keys -t "${SESSION_NAME}:1" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:1" 'echo "Documentation workspace"' C-m
    tmux send-keys -t "${SESSION_NAME}:1" 'ls -la' C-m

    # Window 2: Projects
    tmux new-window -t "${SESSION_NAME}" -n 'projects'
    tmux send-keys -t "${SESSION_NAME}:2" 'cd "${HOME}/Projects" 2>/dev/null || cd "${HOME}"' C-m
    tmux send-keys -t "${SESSION_NAME}:2" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:2" 'echo "Projects workspace"' C-m
    tmux send-keys -t "${SESSION_NAME}:2" 'ls -la' C-m

    # Window 3: System monitoring
    tmux new-window -t "${SESSION_NAME}" -n 'monitor'
    tmux send-keys -t "${SESSION_NAME}:3" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:3" 'echo "System monitoring - press Ctrl+C to exit htop"' C-m
    tmux send-keys -t "${SESSION_NAME}:3" 'htop' C-m

    # Window 4: Development tools
    tmux new-window -t "${SESSION_NAME}" -n 'tools'
    tmux send-keys -t "${SESSION_NAME}:4" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:4" 'echo "Development tools workspace"' C-m
    tmux send-keys -t "${SESSION_NAME}:4" 'echo "Available: git, docker, kubectl, etc."' C-m
    tmux send-keys -t "${SESSION_NAME}:4" 'pwd' C-m

    log "Session ${SESSION_NAME} created successfully with 5 windows"
}

# Function to attach to existing session
attach_session() {
    log "Attaching to existing session: ${SESSION_NAME}"
    tmux attach-session -t "${SESSION_NAME}"
}

# Main execution
main() {
    log "Starting tmux session manager for: ${SESSION_NAME}"

    # Check if session exists
    if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
        log "Session ${SESSION_NAME} already exists"
        attach_session
    else
        create_session
        # Select first window and attach
        tmux select-window -t "${SESSION_NAME}:0"
        attach_session
    fi
}

# Run main function
main "$@"
