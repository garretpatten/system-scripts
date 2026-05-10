#!/bin/bash

# Main tmux session setup script — three windows: btop, home (~ + neo), projects (~/Projects + lls)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tmux-utils.sh
source "${SCRIPT_DIR}/tmux-utils.sh"

readonly SESSION_NAME='main'

create_session() {
    log "${SESSION_NAME}" "Creating new tmux session: ${SESSION_NAME}"

    if ! tmux new-session -d -s "${SESSION_NAME}" -c "${HOME}" -n 'btop'; then
        error_exit "Failed to create tmux session: ${SESSION_NAME}"
    fi

    configure_session_options "${SESSION_NAME}" "green"

    tmux send-keys -t "${SESSION_NAME}:btop" 'btop' C-m

    tmux new-window -t "${SESSION_NAME}" -n 'home' -c "${HOME}"
    prime_user_shell_env "${SESSION_NAME}:home"
    tmux send-keys -t "${SESSION_NAME}:home" 'neo' C-m

    tmux new-window -t "${SESSION_NAME}" -n 'projects' -c "${HOME}/Projects"
    prime_user_shell_env "${SESSION_NAME}:projects"
    tmux send-keys -t "${SESSION_NAME}:projects" 'lls' C-m

    log "${SESSION_NAME}" "Session ${SESSION_NAME} created (windows: btop, home, projects)"
}

attach_session() {
    log "${SESSION_NAME}" "Attaching to existing session: ${SESSION_NAME}"
    tmux attach-session -t "${SESSION_NAME}"
}

main() {
    log "${SESSION_NAME}" "Starting tmux setup for: ${SESSION_NAME}"
    check_tmux_installed

    if session_exists "${SESSION_NAME}"; then
        log "${SESSION_NAME}" "Session ${SESSION_NAME} already exists"
        attach_session
    else
        create_session
        tmux select-window -t "${SESSION_NAME}:home"
        attach_session
    fi
}

main "$@"
