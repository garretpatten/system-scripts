#!/bin/bash

# Tmux utility functions
# Shared functions for tmux session management scripts

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color

# Logging function
log() {
    local log_file="${HOME}/.tmux-session-${1:-general}.log"
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*" | tee -a "${log_file}"
}

# Error handling
error_exit() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

# Check if tmux is installed
check_tmux_installed() {
    if ! command -v tmux >/dev/null 2>&1; then
        error_exit "tmux is not installed. Please install tmux first."
    fi
}

# Check if session exists
session_exists() {
    local session_name="$1"
    tmux has-session -t "${session_name}" 2>/dev/null
}

# Create a new tmux session
create_tmux_session() {
    local session_name="$1"

    if ! tmux new-session -d -s "${session_name}" 2>/dev/null; then
        error_exit "Failed to create tmux session: ${session_name}"
    fi
}

# Configure basic session options
configure_session_options() {
    local session_name="$1"
    local status_color="${2:-green}"

    tmux set-option -t "${session_name}" -g status on
    tmux set-option -t "${session_name}" -g status-interval 1
    tmux set-option -t "${session_name}" -g status-left-length 20
    tmux set-option -t "${session_name}" -g status-right-length 50
    tmux set-option -t "${session_name}" -g status-left "#[fg=${status_color}]#S #[fg=white]| "
    tmux set-option -t "${session_name}" -g status-right '#[fg=yellow]%Y-%m-%d %H:%M:%S'
    tmux set-option -t "${session_name}" -g default-terminal "screen-256color"
}

# Send keys to a tmux window
send_keys_to_window() {
    local session_name="$1"
    local window="$2"
    shift 2
    local commands=("$@")

    for cmd in "${commands[@]}"; do
        tmux send-keys -t "${session_name}:${window}" "${cmd}" C-m
    done
}

# Create a new window with commands
create_window() {
    local session_name="$1"
    local window_name="$2"
    local window_index="$3"
    local working_dir="$4"
    shift 4
    local commands=("$@")

    if [[ "${window_index}" -eq 0 ]]; then
        # Rename the first window
        tmux rename-window -t "${session_name}:0" "${window_name}"
    else
        # Create new window
        tmux new-window -t "${session_name}" -n "${window_name}"
    fi

    # Change to working directory if specified
    if [[ -n "${working_dir}" ]]; then
        tmux send-keys -t "${session_name}:${window_index}" "cd \"${working_dir}\" 2>/dev/null || cd \"${HOME}\"" C-m
    fi

    # Send commands
    for cmd in "${commands[@]}"; do
        tmux send-keys -t "${session_name}:${window_index}" "${cmd}" C-m
    done
}

# Split window horizontally
split_window_horizontal() {
    local session_name="$1"
    local window="$2"
    local commands=("${@:3}")

    tmux split-window -t "${session_name}:${window}" -h

    # Send commands to the new pane
    for cmd in "${commands[@]}"; do
        tmux send-keys -t "${session_name}:${window}.1" "${cmd}" C-m
    done
}

# Split window vertically
split_window_vertical() {
    local session_name="$1"
    local window="$2"
    local commands=("${@:3}")

    tmux split-window -t "${session_name}:${window}" -v

    # Send commands to the new pane
    for cmd in "${commands[@]}"; do
        tmux send-keys -t "${session_name}:${window}.1" "${cmd}" C-m
    done
}

# Attach to session
attach_to_session() {
    local session_name="$1"
    tmux attach-session -t "${session_name}"
}

# List all tmux sessions
list_sessions() {
    echo -e "${CYAN}Active tmux sessions:${NC}"
    tmux list-sessions 2>/dev/null || echo "No active sessions"
}

# Kill a specific session
kill_session() {
    local session_name="$1"
    if session_exists "${session_name}"; then
        tmux kill-session -t "${session_name}"
        echo -e "${GREEN}Session ${session_name} killed${NC}"
    else
        echo -e "${YELLOW}Session ${session_name} does not exist${NC}"
    fi
}

# Kill all sessions
kill_all_sessions() {
    echo -e "${YELLOW}Killing all tmux sessions...${NC}"
    tmux kill-server 2>/dev/null || true
    echo -e "${GREEN}All sessions killed${NC}"
}

# Show session info
show_session_info() {
    local session_name="$1"
    if session_exists "${session_name}"; then
        echo -e "${CYAN}Session ${session_name} info:${NC}"
        tmux list-windows -t "${session_name}"
    else
        echo -e "${YELLOW}Session ${session_name} does not exist${NC}"
    fi
}
