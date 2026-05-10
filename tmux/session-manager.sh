#!/bin/bash

# Comprehensive tmux session manager
# Handles creation and management of different session types

set -euo pipefail

# Source utility functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/tmux-utils.sh"

# Configuration
readonly MAIN_SESSION='main'
readonly DEV_SESSION='dev'
readonly LOG_FILE="${HOME}/.tmux-session-manager.log"

# Usage function
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS] [SESSION_TYPE]

Session Types:
    main    - btop, home (~ + neo), projects (~/Projects + lls)
    dev     - Development-focused session with project tools
    list    - List all active sessions
    kill    - Kill specified session
    killall - Kill all sessions
    info    - Show session information

Options:
    -h, --help     Show this help message
    -v, --verbose  Enable verbose output

Examples:
    $0 main        # Start/attach to main session
    $0 dev         # Start/attach to dev session
    $0 list        # List all sessions
    $0 kill main   # Kill main session
    $0 info dev    # Show dev session info

EOF
}

# Create main session (aligned with setup-main.sh)
create_main_session() {
    local session_name="${MAIN_SESSION}"
    log "${session_name}" "Creating main session: ${session_name}"

    if ! tmux new-session -d -s "${session_name}" -c "${HOME}" -n 'btop'; then
        error_exit "Failed to create tmux session: ${session_name}"
    fi

    configure_session_options "${session_name}" "green"

    tmux send-keys -t "${session_name}:btop" 'btop' C-m

    tmux new-window -t "${session_name}" -n 'home' -c "${HOME}"
    prime_user_shell_env "${session_name}:home"
    tmux send-keys -t "${session_name}:home" 'neo' C-m

    tmux new-window -t "${session_name}" -n 'projects' -c "${HOME}/Projects"
    prime_user_shell_env "${session_name}:projects"
    tmux send-keys -t "${session_name}:projects" 'lls' C-m

    log "${session_name}" "Main session created (windows: btop, home, projects)"
}

# Create development session
create_dev_session() {
    local session_name="${DEV_SESSION}"
    log "${session_name}" "Creating development session: ${session_name}"

    create_tmux_session "${session_name}"
    configure_session_options "${session_name}" "cyan"

    # Window 0: Development Home
    create_window "${session_name}" "dev-home" 0 "" \
        "clear" \
        'echo "Development Session Ready!"' \
        'echo "Quick commands: git status, docker ps, kubectl get pods"' \
        "pwd"

    # Window 1: Active Project (with split panes)
    create_window "${session_name}" "project" 1 "${HOME}/Projects" \
        "clear" \
        'echo "Active project workspace"' \
        "ls -la"

    # Split the project window horizontally
    split_window_horizontal "${session_name}" 1 \
        'echo "Right pane - logs, monitoring, etc."' \
        "pwd"

    # Window 2: Git/Version Control
    create_window "${session_name}" "git" 2 "" \
        "clear" \
        'echo "Git workspace - check status, branches, etc."' \
        "git status 2>/dev/null || echo 'Not in a git repository'"

    # Window 3: Docker/Containers
    create_window "${session_name}" "docker" 3 "" \
        "clear" \
        'echo "Docker workspace"' \
        "docker ps 2>/dev/null || echo 'Docker not running or not installed'"

    # Window 4: Testing/CI
    create_window "${session_name}" "test" 4 "" \
        "clear" \
        'echo "Testing workspace"' \
        'echo "Run tests, linting, etc. here"' \
        "pwd"

    # Window 5: Database/Backend
    create_window "${session_name}" "db" 5 "" \
        "clear" \
        'echo "Database workspace"' \
        'echo "Connect to databases, run queries, etc."' \
        "pwd"

    # Window 6: Logs/Monitoring
    create_window "${session_name}" "logs" 6 "" \
        "clear" \
        'echo "Logs and monitoring"' \
        'echo "Tail logs, monitor system, etc."' \
        "pwd"

    # Set up window layout for project window (1)
    tmux select-window -t "${session_name}:1"
    tmux select-pane -t "${session_name}:1.0"

    log "${session_name}" "Development session created successfully with 7 windows"
}

# Handle session creation or attachment
handle_session() {
    local session_name="$1"
    local session_type="$2"

    if session_exists "${session_name}"; then
        log "${session_name}" "Session ${session_name} already exists, attaching..."
        attach_to_session "${session_name}"
    else
        case "${session_type}" in
            "main")
                create_main_session
                ;;
            "dev")
                create_dev_session
                ;;
            *)
                error_exit "Unknown session type: ${session_type}"
                ;;
        esac
        tmux select-window -t "${session_name}:home"
        attach_to_session "${session_name}"
    fi
}

# Main function
main() {
    local verbose=false
    local session_type=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -v|--verbose)
                verbose=true
                shift
                ;;
            main|dev|list|kill|killall|info)
                session_type="$1"
                shift
                break
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}" >&2
                show_usage
                exit 1
                ;;
        esac
    done

    # Check if tmux is installed
    check_tmux_installed

    case "${session_type}" in
        "main")
            handle_session "${MAIN_SESSION}" "main"
            ;;
        "dev")
            handle_session "${DEV_SESSION}" "dev"
            ;;
        "list")
            list_sessions
            ;;
        "kill")
            if [[ $# -eq 0 ]]; then
                error_exit "Please specify a session to kill"
            fi
            kill_session "$1"
            ;;
        "killall")
            kill_all_sessions
            ;;
        "info")
            if [[ $# -eq 0 ]]; then
                error_exit "Please specify a session to show info for"
            fi
            show_session_info "$1"
            ;;
        "")
            echo -e "${YELLOW}No session type specified. Use -h for help.${NC}"
            show_usage
            exit 1
            ;;
        *)
            error_exit "Unknown session type: ${session_type}"
            ;;
    esac
}

# Run main function
main "$@"
