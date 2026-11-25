#!/usr/bin/env bash
# Clone All GitHub Repositories
# Lists all non-archived GitHub repos and clones any that are missing locally.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR
readonly LOG_DIR="$SCRIPT_DIR/logs"
RUN_TS=$(date +%Y%m%d-%H%M%S)
readonly RUN_TS
readonly LOG_FILE="$LOG_DIR/clone-all-$RUN_TS.log"
readonly ERROR_LOG="$LOG_DIR/clone-all-errors-$RUN_TS.log"

# Optional: GitHub token for private repos
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# Optional: GitHub username (auto-detected if token provided)
GITHUB_USERNAME="${GITHUB_USERNAME:-}"

# Prefer SSH clone from GitHub? (requires your SSH keys set up for GitHub)
USE_GITHUB_SSH="${USE_GITHUB_SSH:-false}"

# Where to clone repositories (resolved at runtime; see resolve_projects_dir)
PROJECTS_DIR="${PROJECTS_DIR:-}"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE" >&2
}

log_info() {
    log "INFO" "${BLUE}$*${NC}"
}

log_success() {
    log "SUCCESS" "${GREEN}$*${NC}"
}

log_warning() {
    log "WARNING" "${YELLOW}$*${NC}"
}

log_error() {
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    log "ERROR" "${RED}$*${NC}"
    echo -e "${timestamp} [ERROR] $*" >> "$ERROR_LOG"
}

error_exit() {
    log_error "Fatal error: $1"
    exit 1
}

# Source shared helpers from sync-all.sh (get_default_branch, sync_repo,
# resolve_projects_dir, etc.). This is done here so clone-all's log functions
# are defined first and are not overwritten by sync-all's no-op sourced
# versions.
SYNC_SCRIPT="$SCRIPT_DIR/sync-all.sh"
if [[ -f "$SYNC_SCRIPT" ]]; then
    # shellcheck disable=SC1090,SC1091
    source "$SYNC_SCRIPT"
fi

check_dependencies() {
    log_info "Checking dependencies..."

    local missing_deps=()

    if ! command -v git &> /dev/null; then
        missing_deps+=("git")
    fi

    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
    fi

    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        error_exit "Missing required dependencies: ${missing_deps[*]}. Please install them and try again."
    fi

    log_success "All dependencies found"
}

get_github_username() {
    if [ -n "${GITHUB_USERNAME:-}" ]; then
        log_success "Using GitHub username from env: $GITHUB_USERNAME"
        return 0
    fi

    if [ -n "${GITHUB_TOKEN:-}" ]; then
        log_info "Detecting GitHub username via API (/user)..."
        local resp=""
        resp="$(curl -sS -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user 2>>"$ERROR_LOG")" ||
            log_warning "GitHub API request failed; will prompt for username."
        local login
        login="$(echo "$resp" | jq -r '.login // empty' 2>>"$ERROR_LOG" || true)"
        if [ -n "$login" ] && [ "$login" != "null" ]; then
            GITHUB_USERNAME="$login"
            log_success "Detected GitHub username: $GITHUB_USERNAME"
            return 0
        fi
        log_warning "Could not detect GitHub username from token; will prompt."
    fi

    read -r -p "Enter your GitHub username: " GITHUB_USERNAME
    [ -n "$GITHUB_USERNAME" ] || error_exit "GitHub username is required"
    log_success "Using GitHub username: $GITHUB_USERNAME"
}

setup_directories() {
    mkdir -p "$LOG_DIR" || {
        echo "Error: Failed to create log directory: $LOG_DIR" >&2
        exit 1
    }

    if [ ! -d "$PROJECTS_DIR" ]; then
        log_info "Creating Projects directory: $PROJECTS_DIR"
        mkdir -p "$PROJECTS_DIR" || {
            log_error "Failed to create Projects directory: $PROJECTS_DIR"
            exit 1
        }
    fi

    log_success "Directories set up successfully"
}

get_github_repos() {
    log_info "Fetching GitHub repos (excluding archived) for: $GITHUB_USERNAME"

    local page=1
    local per_page=100

    while true; do
        local url
        local resp

        if [ -n "${GITHUB_TOKEN:-}" ]; then
            url="https://api.github.com/user/repos?page=$page&per_page=$per_page&type=all&sort=updated"
            if ! resp="$(curl -sS -H "Authorization: token $GITHUB_TOKEN" "$url" 2>>"$ERROR_LOG")"; then
                error_exit "GitHub API request failed (page $page). Check your network and GITHUB_TOKEN."
            fi
        else
            url="https://api.github.com/users/$GITHUB_USERNAME/repos?page=$page&per_page=$per_page&type=all&sort=updated"
            if ! resp="$(curl -sS "$url" 2>>"$ERROR_LOG")"; then
                error_exit "GitHub API request failed (page $page). Check your network connection."
            fi
        fi

        # Fail loudly on API errors and malformed responses instead of
        # silently treating them as an empty repository list.
        if ! echo "$resp" | jq -e 'type == "array"' >/dev/null 2>&1; then
            local msg
            msg="$(echo "$resp" | jq -r '.message // empty' 2>>"$ERROR_LOG" || echo "unknown")"
            error_exit "GitHub API error: ${msg:-invalid response on page $page}"
        fi

        local jq_clone_field
        if [ "$USE_GITHUB_SSH" = "true" ]; then
            jq_clone_field='.ssh_url'
        else
            jq_clone_field='.clone_url'
        fi

        echo "$resp" | jq -r ".[] | select(.archived == false) | ${jq_clone_field}" 2>>"$ERROR_LOG"

        # Paginate on the raw page size: archived repos are filtered out
        # above, so a page can yield no clone URLs and still have more
        # pages after it.
        local page_size
        page_size="$(echo "$resp" | jq 'length')"
        if [ "$page_size" -lt "$per_page" ]; then
            break
        fi

        page=$((page + 1))
    done
}

clone_repository() {
    local repo_url="$1"
    local repo_path="$2"
    local repo_name="$3"
    local original_dir
    original_dir=$(pwd)

    # Credentials go through git's environment config (http.extraHeader)
    # instead of the clone URL, so the token is never written to .git/config
    # and never appears in process listings or error output (git 2.31+).
    local -a git_env=(GIT_TERMINAL_PROMPT=0)
    if [ "$USE_GITHUB_SSH" != "true" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
        local basic_auth
        basic_auth="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '[:space:]')"
        git_env+=(
            GIT_CONFIG_COUNT=1
            GIT_CONFIG_KEY_0=http.extraHeader
            GIT_CONFIG_VALUE_0="Authorization: Basic ${basic_auth}"
        )
    fi

    if env "${git_env[@]}" git clone "$repo_url" "$repo_path" 2>>"$ERROR_LOG"; then
        log_success "Successfully cloned: $repo_name"

        if cd "$repo_path" 2>/dev/null; then
            local default_branch
            if default_branch=$(get_default_branch 2>/dev/null); then
                log_info "Checking out default branch: $default_branch"
                if git checkout "$default_branch" >/dev/null 2>>"$ERROR_LOG"; then
                    log_success "Checked out default branch for $repo_name"
                else
                    log_warning "Could not checkout $default_branch for $repo_name"
                fi
            else
                log_warning "Could not determine default branch for $repo_name. Staying on current branch."
            fi
            cd "$original_dir" 2>/dev/null || true
        fi
        return 0
    fi

    log_error "Failed to clone: $repo_name"
    return 1
}

main() {
    PROJECTS_DIR=$(resolve_projects_dir "${1:-}")
    readonly PROJECTS_DIR

    setup_directories

    log_info "Starting GitHub clone-all"
    log_info "Projects directory: $PROJECTS_DIR"
    log_info "Log file: $LOG_FILE"
    log_info "Error log: $ERROR_LOG"

    check_dependencies
    get_github_username

    # Capture the listing in the main shell: get_github_repos runs to
    # completion (or exits fatally on API errors) before cloning starts,
    # instead of dying quietly inside a process substitution.
    local repos=""
    repos="$(get_github_repos)" || error_exit "Failed to list GitHub repositories"

    local total=0
    local cloned=0
    local skipped=0
    local failed=0

    while IFS= read -r repo_url; do
        [ -n "${repo_url:-}" ] || continue
        total=$((total + 1))

        local repo_name
        repo_name=$(basename "$repo_url" .git)
        local repo_path="$PROJECTS_DIR/$repo_name"

        if [ -d "$repo_path" ]; then
            log_info "Already exists, skipping: $repo_name"
            skipped=$((skipped + 1))
            continue
        fi

        log_info "Cloning repository: $repo_name"
        if clone_repository "$repo_url" "$repo_path" "$repo_name"; then
            cloned=$((cloned + 1))
        else
            failed=$((failed + 1))
        fi
    done <<< "$repos"

    if [ "$total" -eq 0 ]; then
        log_warning "No repositories found"
        exit 0
    fi

    log_success "Clone process completed!"
    log_info "Total repositories: $total"
    log_info "Cloned: $cloned"
    log_info "Skipped (already present): $skipped"
    log_info "Failed: $failed"

    if [ "$failed" -gt 0 ]; then
        log_warning "Some repositories failed to clone. Check error log: $ERROR_LOG"
        exit 1
    fi
}

main "$@"
