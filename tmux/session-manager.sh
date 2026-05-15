#!/bin/bash

# Comprehensive tmux session manager
# Handles creation and management of different session types

set -euo pipefail

# Source utility functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1090,SC1091
source "${SCRIPT_DIR}/tmux-utils.sh"

# Configuration
readonly MAIN_SESSION='main'
readonly DEV_SESSION='dev'
# readonly LOG_FILE

# Usage function
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS] [SESSION_TYPE]

Session Types:
    main    - btop, home (~ + neo), projects (~/Projects + lls)
    dev     - btop, home (~ + neo), projects (~/Projects + lls), git (~/Projects)
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
    create_main_session_windows "${session_name}"

    log "${session_name}" "Main session created (windows: btop, home, projects)"
}

# Create development session (aligned with setup-dev.sh)
create_dev_session() {
    local session_name="${DEV_SESSION}"
    log "${session_name}" "Creating development session: ${session_name}"

    if ! tmux new-session -d -s "${session_name}" -c "${HOME}" -n 'btop'; then
        error_exit "Failed to create tmux session: ${session_name}"
    fi

    configure_session_options "${session_name}" "cyan"
    create_main_session_windows "${session_name}"

    tmux new-window -t "${session_name}" -n 'git' -c "${HOME}/Projects"
    prepare_tmux_pane "${session_name}:git" "${HOME}/Projects"

    log "${session_name}" "Development session created (windows: btop, home, projects, git)"
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
# verbose=false
    local session_type=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -v|--verbose)
                # verbose
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
