#!/usr/bin/env bash
# Todoist Backup Script
# - Retrieves active tasks, projects, and labels via the Todoist REST API
# - Writes JSON backups to a temporary directory
# - Creates a timestamped zip archive

set -euo pipefail

# ----------------------------
# Configuration
# ----------------------------
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR

# Load user-specific environment variables from project root .env if present.
# Variables already exported in the shell take precedence over .env values.
# shellcheck disable=SC1091 source=../backups-utils.sh
source "$SCRIPT_DIR/../backups-utils.sh"
load_env_file

readonly LOG_DIR="$SCRIPT_DIR/../logs"
RUN_TS=$(date +%Y%m%d-%H%M%S)
readonly RUN_TS
readonly LOG_FILE="$LOG_DIR/todoist-backup-$RUN_TS.log"
readonly ERROR_LOG="$LOG_DIR/todoist-errors-$RUN_TS.log"

# Required:
: "${TODOIST_API_TOKEN:?Set TODOIST_API_TOKEN in env or .env}"

# Backup directory and archive
BACKUP_DATE=$(date +%Y-%m-%d)
readonly BACKUP_DATE
readonly BACKUP_DIR_NAME="Todoist-Export_${BACKUP_DATE}"
readonly BACKUP_DIR="$HOME/$BACKUP_DIR_NAME"
readonly BACKUP_ZIP="$HOME/${BACKUP_DIR_NAME}.zip"

# Todoist REST API
readonly TODOIST_API="https://api.todoist.com/rest/v2"

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
log_error()   {
    local ts; ts="$(date '+%Y-%m-%d %H:%M:%S')"
    log "ERROR" "${RED}$*${NC}"
    echo -e "${ts} [ERROR] $*" >> "$ERROR_LOG"
}

error_exit() {
    log_error "Fatal: $1"
    exit 1
}

# ----------------------------
# Dependencies
# ----------------------------
check_dependencies() {
    log_info "Checking dependencies..."
    local missing=()
    for cmd in curl jq zip; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [ ${#missing[@]} -ne 0 ]; then
        error_exit "Missing dependencies: ${missing[*]} (install and retry)"
    fi
    log_success "All dependencies found"
}

# ----------------------------
# Todoist API helpers
# ----------------------------
todoist_api_get() {
    local path="$1"
    curl -sS -f \
        --header "Authorization: Bearer $TODOIST_API_TOKEN" \
        "$TODOIST_API$path" 2>>"$ERROR_LOG"
}

# Fetch a paged collection from Todoist. The REST API returns up to 200 items
# per request; continue until a page returns fewer results.
fetch_collection() {
    local endpoint="$1"
    local limit=200
    local offset=0

    while true; do
        local resp
        if ! resp="$(todoist_api_get "${endpoint}?limit=${limit}&offset=${offset}")"; then
            error_exit "Todoist API request failed on ${endpoint}"
        fi

        if ! echo "$resp" | jq -e . >/dev/null 2>&1; then
            error_exit "Todoist API returned non-JSON response on ${endpoint}"
        fi

        if echo "$resp" | jq -e '.message? // .error? // empty' >/dev/null 2>&1; then
            local msg
            msg="$(echo "$resp" | jq -r '.message? // .error? // "unknown"' 2>/dev/null)"
            error_exit "Todoist API error on ${endpoint}: $msg"
        fi

        local count
        count="$(echo "$resp" | jq 'length')"

        if [ "$count" -eq 0 ]; then
            break
        fi

        echo "$resp"

        if [ "$count" -lt "$limit" ]; then
            break
        fi

        offset=$((offset + limit))
    done
}

# Fetch all tasks and merge pages into one JSON array.
fetch_all_tasks() {
    log_info "Fetching all active tasks..."

    local temp_dir
    temp_dir="$(mktemp -d)"
    local merged_file="$temp_dir/tasks.json"
    echo "[]" > "$merged_file"

    local pages_file="$temp_dir/pages.json"
    if ! fetch_collection "/tasks" > "$pages_file"; then
        rm -rf "$temp_dir"
        return 1
    fi

    while IFS= read -r page; do
        [ -n "${page:-}" ] || continue
        jq -s '.[0] + .[1]' "$merged_file" <(echo "$page") > "$merged_file.tmp"
        mv "$merged_file.tmp" "$merged_file"
    done < "$pages_file"

    jq '.' "$merged_file"
    rm -rf "$temp_dir"
}

# ----------------------------
# Backup creation
# ----------------------------
backup_collection() {
    local endpoint="$1"
    local filename="$2"

    log_info "Fetching ${filename}..."
    local resp
    if ! resp="$(todoist_api_get "$endpoint")"; then
        log_warn "Todoist API request failed on ${endpoint}"
        echo "[]" > "$BACKUP_DIR/$filename"
        return 1
    fi

    if ! echo "$resp" | jq -e . >/dev/null 2>&1; then
        log_warn "Todoist API returned non-JSON response on ${endpoint}"
        echo "[]" > "$BACKUP_DIR/$filename"
        return 1
    fi

    if echo "$resp" | jq -e '.message? // .error? // empty' >/dev/null 2>&1; then
        local msg
        msg="$(echo "$resp" | jq -r '.message? // .error? // "unknown"' 2>/dev/null)"
        log_warn "Todoist API error on ${endpoint}: $msg"
        echo "[]" > "$BACKUP_DIR/$filename"
        return 1
    fi

    echo "$resp" | jq '.' > "$BACKUP_DIR/$filename"
    local count
    count="$(echo "$resp" | jq 'length')"
    log_success "Saved ${count} ${filename%.json}"
}

setup_directories() {
    mkdir -p "$LOG_DIR" || {
        echo "Error: Failed to create log directory: $LOG_DIR" >&2
        exit 1
    }

    if [ -d "$BACKUP_DIR" ]; then
        log_info "Removing previous backup directory: $BACKUP_DIR"
        rm -rf "$BACKUP_DIR"
    fi

    mkdir -p "$BACKUP_DIR" || {
        log_error "Failed to create backup directory: $BACKUP_DIR"
        exit 1
    }
}

create_backup() {
    log_info "Creating Todoist backup zip..."

    local original_dir
    original_dir=$(pwd)
    cd "$HOME" || error_exit "Failed to change to home directory"

    if zip -r "$BACKUP_ZIP" "$BACKUP_DIR_NAME" 2>>"$ERROR_LOG"; then
        log_success "Backup created successfully: $BACKUP_ZIP"
        log_info "Backup size: $(du -h "$BACKUP_ZIP" | cut -f1)"
    else
        error_exit "Failed to create backup zip file"
    fi

    cd "$original_dir" || error_exit "Failed to return to original directory"
}

# ----------------------------
# Main
# ----------------------------
main() {
    setup_directories

    log_info "Starting Todoist Backup"
    log_info "Backup directory: $BACKUP_DIR"
    log_info "Log: $LOG_FILE"
    log_info "Errors: $ERROR_LOG"

    check_dependencies

    local tasks_json
    if ! tasks_json="$(fetch_all_tasks)"; then
        error_exit "Failed to fetch Todoist tasks"
    fi

    local task_count
    task_count="$(echo "$tasks_json" | jq 'length')"
    echo "$tasks_json" | jq '.' > "$BACKUP_DIR/tasks.json"
    log_success "Saved ${task_count} tasks"

    backup_collection "/projects" "projects.json"
    backup_collection "/labels" "labels.json"

    create_backup

    log_success "Todoist backup completed!"
    log_info "Tasks backed up: $task_count"
    log_info "Archive: $BACKUP_ZIP"

    rm -rf "$BACKUP_DIR"
}

main "$@"
