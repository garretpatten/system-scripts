#!/usr/bin/env bash
# Backups Orchestrator
# Runs all configured backup scripts: code-local, code-gitlab, and todoist.

set -euo pipefail

# ----------------------------
# Configuration
# ----------------------------
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR
readonly LOG_DIR="$SCRIPT_DIR/logs"

RUN_TS=$(date +%Y%m%d-%H%M%S)
readonly RUN_TS
readonly LOG_FILE="$LOG_DIR/backups-$RUN_TS.log"

# Load environment variables from project root .env if present
PROJECT_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Sub-scripts
readonly CODE_LOCAL_SCRIPT="$SCRIPT_DIR/code/code-backup-local.sh"
readonly CODE_GITLAB_SCRIPT="$SCRIPT_DIR/code/code-backup-gitlab.sh"
readonly TODOIST_SCRIPT="$SCRIPT_DIR/todoist/todoist-backup.sh"

# ----------------------------
# Pretty logging
# ----------------------------
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

log() {
    local level="$1"; shift
    local msg="$*"
    local ts; ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "${ts} [${level}] ${msg}" | tee -a "$LOG_FILE" >&2
}

log_info()    { log "INFO"    "${BLUE}$*${NC}"; }
log_success() { log "SUCCESS" "${GREEN}$*${NC}"; }
log_warn()    { log "WARN"    "${YELLOW}$*${NC}"; }
log_error()   { log "ERROR"   "${RED}$*${NC}"; }

error_exit() {
    log_error "Fatal: $1"
    exit 1
}

# ----------------------------
# Helpers
# ----------------------------
setup_directories() {
    mkdir -p "$LOG_DIR" || {
        echo "Error: Failed to create log directory: $LOG_DIR" >&2
        exit 1
    }
}

run_backup() {
    local name="$1"
    local script="$2"

    log_info "Starting backup: $name"

    if [ ! -x "$script" ]; then
        if [ -f "$script" ]; then
            chmod +x "$script" || {
                log_warn "Could not make $script executable; skipping $name"
                return 1
            }
        else
            log_warn "Backup script not found: $script"
            return 1
        fi
    fi

    if "$script" >> "$LOG_FILE" 2>&1; then
        log_success "Backup completed: $name"
        return 0
    else
        log_warn "Backup failed or had errors: $name"
        return 1
    fi
}

# ----------------------------
# Main
# ----------------------------
main() {
    setup_directories

    log_info "Starting all backups"
    log_info "Log: $LOG_FILE"

    local code_local_status=0
    local code_gitlab_status=0
    local todoist_status=0

    run_backup "code-local" "$CODE_LOCAL_SCRIPT"  || code_local_status=$?
    run_backup "code-gitlab" "$CODE_GITLAB_SCRIPT" || code_gitlab_status=$?
    run_backup "todoist" "$TODOIST_SCRIPT"         || todoist_status=$?

    log_info "Backup summary:"
    log_info "  code-local : $([ "$code_local_status" -eq 0 ] && echo "OK" || echo "FAILED")"
    log_info "  code-gitlab: $([ "$code_gitlab_status" -eq 0 ] && echo "OK" || echo "FAILED")"
    log_info "  todoist    : $([ "$todoist_status" -eq 0 ] && echo "OK" || echo "FAILED")"

    if [ "$code_local_status" -ne 0 ] || [ "$code_gitlab_status" -ne 0 ] || [ "$todoist_status" -ne 0 ]; then
        log_warn "One or more backups failed. See: $LOG_FILE"
        exit 1
    fi

    log_success "All backups completed successfully"
}

main "$@"
