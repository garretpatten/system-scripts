#!/bin/bash

# Development tmux session setup script
# Creates or reattaches to a development session with development-focused windows

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Configuration
readonly SESSION_NAME='dev'
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
    log "Creating new development tmux session: ${SESSION_NAME}"

    # Create detached session
    if ! tmux new-session -d -s "${SESSION_NAME}" 2>/dev/null; then
        error_exit "Failed to create tmux session: ${SESSION_NAME}"
    fi

    # Configure session options for development
    tmux set-option -t "${SESSION_NAME}" -g status on
    tmux set-option -t "${SESSION_NAME}" -g status-interval 1
    tmux set-option -t "${SESSION_NAME}" -g status-left-length 20
    tmux set-option -t "${SESSION_NAME}" -g status-right-length 50
    tmux set-option -t "${SESSION_NAME}" -g status-left '#[fg=cyan]#S #[fg=white]| '
    tmux set-option -t "${SESSION_NAME}" -g status-right '#[fg=yellow]%Y-%m-%d %H:%M:%S'
    tmux set-option -t "${SESSION_NAME}" -g default-terminal "screen-256color"

    # Window 0: Development Home
    tmux rename-window -t "${SESSION_NAME}:0" 'dev-home'
    tmux send-keys -t "${SESSION_NAME}:0" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:0" 'echo "Development Session Ready!"' C-m
    tmux send-keys -t "${SESSION_NAME}:0" 'echo "Quick commands: git status, docker ps, kubectl get pods"' C-m
    tmux send-keys -t "${SESSION_NAME}:0" 'pwd' C-m

    # Window 1: Active Project (with split panes)
    tmux new-window -t "${SESSION_NAME}" -n 'project'
    tmux send-keys -t "${SESSION_NAME}:1" 'cd "${HOME}/Projects" 2>/dev/null || cd "${HOME}"' C-m
    tmux send-keys -t "${SESSION_NAME}:1" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:1" 'echo "Active project workspace"' C-m
    tmux send-keys -t "${SESSION_NAME}:1" 'ls -la' C-m

    # Split the project window horizontally
    tmux split-window -t "${SESSION_NAME}:1" -h
    tmux send-keys -t "${SESSION_NAME}:1.1" 'echo "Right pane - logs, monitoring, etc."' C-m
    tmux send-keys -t "${SESSION_NAME}:1.1" 'pwd' C-m

    # Window 2: Git/Version Control
    tmux new-window -t "${SESSION_NAME}" -n 'git'
    tmux send-keys -t "${SESSION_NAME}:2" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:2" 'echo "Git workspace - check status, branches, etc."' C-m
    tmux send-keys -t "${SESSION_NAME}:2" 'git status 2>/dev/null || echo "Not in a git repository"' C-m

    # Window 3: Docker/Containers
    tmux new-window -t "${SESSION_NAME}" -n 'docker'
    tmux send-keys -t "${SESSION_NAME}:3" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:3" 'echo "Docker workspace"' C-m
    tmux send-keys -t "${SESSION_NAME}:3" 'docker ps 2>/dev/null || echo "Docker not running or not installed"' C-m

    # Window 4: Testing/CI
    tmux new-window -t "${SESSION_NAME}" -n 'test'
    tmux send-keys -t "${SESSION_NAME}:4" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:4" 'echo "Testing workspace"' C-m
    tmux send-keys -t "${SESSION_NAME}:4" 'echo "Run tests, linting, etc. here"' C-m
    tmux send-keys -t "${SESSION_NAME}:4" 'pwd' C-m

    # Window 5: Database/Backend
    tmux new-window -t "${SESSION_NAME}" -n 'db'
    tmux send-keys -t "${SESSION_NAME}:5" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:5" 'echo "Database workspace"' C-m
    tmux send-keys -t "${SESSION_NAME}:5" 'echo "Connect to databases, run queries, etc."' C-m
    tmux send-keys -t "${SESSION_NAME}:5" 'pwd' C-m

    # Window 6: Logs/Monitoring
    tmux new-window -t "${SESSION_NAME}" -n 'logs'
    tmux send-keys -t "${SESSION_NAME}:6" 'clear' C-m
    tmux send-keys -t "${SESSION_NAME}:6" 'echo "Logs and monitoring"' C-m
    tmux send-keys -t "${SESSION_NAME}:6" 'echo "Tail logs, monitor system, etc."' C-m
    tmux send-keys -t "${SESSION_NAME}:6" 'pwd' C-m

    # Set up window layout for project window (1)
    tmux select-window -t "${SESSION_NAME}:1"
    tmux select-pane -t "${SESSION_NAME}:1.0"

    log "Development session ${SESSION_NAME} created successfully with 7 windows"
}

# Function to attach to existing session
attach_session() {
    log "Attaching to existing development session: ${SESSION_NAME}"
    tmux attach-session -t "${SESSION_NAME}"
}

# Main execution
main() {
    log "Starting development tmux session manager for: ${SESSION_NAME}"

    # Check if session exists
    if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
        log "Development session ${SESSION_NAME} already exists"
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
