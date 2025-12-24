#!/usr/bin/env bash
# GitHub Projects Local Backup Script
# - Lists all non-archived GitHub repos you can access
# - Clones/updates them locally
# - Creates a timestamped zip backup

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECTS_DIR="${PROJECTS_DIR:-$HOME/Projects}"
readonly LOG_DIR="$SCRIPT_DIR/logs"
readonly RUN_TS="$(date +%Y%m%d-%H%M%S)"
readonly LOG_FILE="$LOG_DIR/code-backup-$RUN_TS.log"
readonly ERROR_LOG="$LOG_DIR/errors-$RUN_TS.log"

# Optional: GitHub token for private repos
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# Optional: GitHub username (auto-detected if token provided)
GITHUB_USERNAME="${GITHUB_USERNAME:-}"

# Prefer SSH clone from GitHub? (requires your SSH keys set up for GitHub)
USE_GITHUB_SSH="${USE_GITHUB_SSH:-false}"

# Backup directory will be created with date format
readonly BACKUP_DATE=$(date +%m-%d-%y)
readonly BACKUP_DIR_NAME="Code-Backup_${BACKUP_DATE}"
readonly BACKUP_DIR="$HOME/$BACKUP_DIR_NAME"
readonly PROJECTS_DIR="$BACKUP_DIR"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Global variables
TOTAL_REPOS=0
SUCCESSFUL_REPOS=0
FAILED_REPOS=0

# Logging functions
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
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
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    log "ERROR" "${RED}$*${NC}"
    echo -e "${timestamp} [ERROR] $*" >> "$ERROR_LOG"
}

# Error handling
error_exit() {
    log_error "Fatal error: $1"
    exit 1
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary files..."
    # Add any cleanup logic here if needed
}

# Set up trap for cleanup on exit
trap cleanup EXIT

# Check dependencies
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

    if ! command -v zip &> /dev/null; then
        missing_deps+=("zip")
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        error_exit "Missing required dependencies: ${missing_deps[*]}. Please install them and try again."
    fi

    log_success "All dependencies found"
}

# Get GitHub username
get_github_username() {
    if [ -n "${GITHUB_USERNAME:-}" ]; then
        log_success "Using GitHub username from env: $GITHUB_USERNAME"
        return 0
    fi

    if [ -n "${GITHUB_TOKEN:-}" ]; then
        log_info "Detecting GitHub username via API (/user)..."
        local resp
        resp="$(curl -sS -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user 2>>"$ERROR_LOG" || true)"
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

# Create necessary directories
setup_directories() {
    # Create log directory first (needed for logging)
    mkdir -p "$LOG_DIR" || {
        echo "Error: Failed to create log directory: $LOG_DIR" >&2
        exit 1
    }

    # Create Projects directory
    if [ ! -d "$PROJECTS_DIR" ]; then
        log_info "Creating Projects directory: $PROJECTS_DIR"
        mkdir -p "$PROJECTS_DIR" || {
            log_error "Failed to create Projects directory: $PROJECTS_DIR"
            exit 1
        }
    fi

    log_success "Directories set up successfully"
}

# Get all GitHub repositories (non-archived only)
# Returns lines: "<clone_url>"
get_github_repos() {
    log_info "Fetching GitHub repos (excluding archived) for: $GITHUB_USERNAME"

    local page=1
    local per_page=100

    # Check for GitHub token for private repos
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        log_info "Using GitHub token for authentication" >&2
    fi

    while true; do
        local url
        local resp

        if [ -n "${GITHUB_TOKEN:-}" ]; then
            # Authenticated: includes private repos you can access
            url="https://api.github.com/user/repos?page=$page&per_page=$per_page&type=all&sort=updated"
            resp="$(curl -sS -H "Authorization: token $GITHUB_TOKEN" "$url" 2>>"$ERROR_LOG" || true)"
        else
            # Unauthenticated: only public repos
            url="https://api.github.com/users/$GITHUB_USERNAME/repos?page=$page&per_page=$per_page&type=all&sort=updated"
            resp="$(curl -sS "$url" 2>>"$ERROR_LOG" || true)"
        fi

        # Error?
        if echo "$resp" | jq -e '.message? // empty' >/dev/null 2>&1; then
            local msg; msg="$(echo "$resp" | jq -r '.message' 2>>"$ERROR_LOG" || echo "unknown")"
            error_exit "GitHub API error: $msg"
        fi

        # Choose clone URL style
        local jq_clone_field
        if [ "$USE_GITHUB_SSH" = "true" ]; then
            jq_clone_field='.ssh_url'
        else
            jq_clone_field='.clone_url'
        fi

        # Emit clone URLs, excluding archived
        local lines
        lines="$(echo "$resp" | jq -r --argjson _ 0 \
            ".[] | select(.archived == false) | ${jq_clone_field}" 2>>"$ERROR_LOG" || true)"

        [ -n "$lines" ] || break

        # Print for caller
        echo "$lines"

        # Last page?
        local count
        count="$(echo "$lines" | wc -l | tr -d ' ')"
        if [ "$count" -lt "$per_page" ]; then
            break
        fi

        page=$((page + 1))
    done
}

# Get default branch for a repository
get_default_branch() {
    local repo_url="$1"
    local repo_name="$2"

    # Try to get default branch from remote
    local default_branch
    if default_branch=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}' 2>/dev/null); then
        if [ -n "$default_branch" ]; then
            echo "$default_branch"
            return 0
        fi
    fi

    # Fallback: check common branch names
    for branch in main master develop; do
        if git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
            echo "$branch"
            return 0
        fi
    done

    # Last resort: use the first available branch
    local first_branch
    first_branch=$(git branch -r --format='%(refname:short)' | head -1 | sed 's/origin\///')
    if [ -n "$first_branch" ]; then
        echo "$first_branch"
        return 0
    fi

    log_warning "Could not determine default branch for $repo_name"
    return 1
}

# Clone or update repository
process_repository() {
    local repo_url="$1"
    local repo_name=$(basename "$repo_url" .git)
    local repo_path="$PROJECTS_DIR/$repo_name"

    log_info "Processing repository: $repo_name"

    if [ -d "$repo_path" ]; then
        log_info "Repository exists, updating: $repo_name"
        update_repository "$repo_path" "$repo_name"
    else
        log_info "Cloning new repository: $repo_name"
        clone_repository "$repo_url" "$repo_path" "$repo_name"
    fi
}

# Clone a new repository
clone_repository() {
    local repo_url="$1"
    local repo_path="$2"
    local repo_name="$3"
    local original_dir=$(pwd)

    # If using HTTPS and token exists, inject it (so private clones work non-interactively)
    local effective_clone_url="$repo_url"
    if [ "$USE_GITHUB_SSH" != "true" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
        # GitHub supports token auth via x-access-token username.
        effective_clone_url="$(echo "$repo_url" | sed "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
    fi

    if git clone "$effective_clone_url" "$repo_path" 2>>"$ERROR_LOG"; then
        log_success "Successfully cloned: $repo_name"
        ((SUCCESSFUL_REPOS++))

        # Checkout default branch
        if cd "$repo_path" 2>/dev/null; then
            local default_branch
            if default_branch=$(get_default_branch "$repo_url" "$repo_name" 2>/dev/null); then
                git checkout "$default_branch" 2>>"$ERROR_LOG" || log_warning "Could not checkout $default_branch for $repo_name"
            fi
            cd "$original_dir" 2>/dev/null || true
        fi
    else
        log_error "Failed to clone: $repo_name"
        ((FAILED_REPOS++))
    fi
}

# Update an existing repository
update_repository() {
    local repo_path="$1"
    local repo_name="$2"
    local original_dir=$(pwd)

    if ! cd "$repo_path" 2>/dev/null; then
        log_error "Failed to change to repository directory: $repo_name"
        ((FAILED_REPOS++))
        return 1
    fi

    # Fetch latest changes
    if ! git fetch origin 2>>"$ERROR_LOG"; then
        log_error "Failed to fetch updates for: $repo_name"
        ((FAILED_REPOS++))
        cd "$original_dir" 2>/dev/null || true
        return 1
    fi

    # Get current branch
    local current_branch
    current_branch=$(git branch --show-current 2>/dev/null || echo "")

    # Get default branch
    local default_branch
    if ! default_branch=$(get_default_branch "" "$repo_name" 2>/dev/null); then
        log_warning "Could not determine default branch for $repo_name, skipping"
        ((FAILED_REPOS++))
        cd "$original_dir" 2>/dev/null || true
        return 1
    fi

    # Switch to default branch if not already on it
    if [ "$current_branch" != "$default_branch" ]; then
        log_info "Switching to default branch: $default_branch"
        if ! git checkout "$default_branch" 2>>"$ERROR_LOG"; then
            log_error "Failed to checkout $default_branch for $repo_name"
            ((FAILED_REPOS++))
            cd "$original_dir" 2>/dev/null || true
            return 1
        fi
    fi

    # Pull latest changes
    if git pull origin "$default_branch" 2>>"$ERROR_LOG"; then
        log_success "Successfully updated: $repo_name"
        ((SUCCESSFUL_REPOS++))
    else
        log_error "Failed to pull updates for: $repo_name"
        ((FAILED_REPOS++))
    fi

    cd "$original_dir" 2>/dev/null || true
}

# Create backup zip file
create_backup() {
    log_info "Creating backup zip file..."

    local backup_name="${BACKUP_DIR_NAME}.zip"
    local backup_path="$HOME/$backup_name"

    # Change to home directory to create zip
    local original_dir=$(pwd)
    cd "$HOME" || error_exit "Failed to change to home directory"

    if zip -r "$backup_path" "$BACKUP_DIR_NAME" -x "*.git/*" "*.DS_Store" "*.log" 2>>"$ERROR_LOG"; then
        log_success "Backup created successfully: $backup_path"
        log_info "Backup size: $(du -h "$backup_path" | cut -f1)"

        # Optionally remove the directory after zipping (uncomment if desired)
        # log_info "Removing backup directory after zipping..."
        # rm -rf "$BACKUP_DIR"
    else
        error_exit "Failed to create backup zip file"
    fi

    cd "$original_dir" || error_exit "Failed to return to original directory"
}

# Main function
main() {
    # Setup directories first before any logging
    setup_directories

    log_info "Starting GitHub Projects Local Backup"
    log_info "Projects directory: $PROJECTS_DIR"
    log_info "Log file: $LOG_FILE"
    log_info "Error log: $ERROR_LOG"

    check_dependencies
    get_github_username

    local total=0 ok=0 fail=0

    # Stream repos line-by-line
    while IFS= read -r repo_url; do
        [ -n "${repo_url:-}" ] || continue
        total=$((total + 1))

        if process_repository "$repo_url"; then
            ok=$((ok + 1))
        else
            fail=$((fail + 1))
        fi
    done < "$temp_file"
    rm -f "$temp_file"

    log_info "Loaded ${#repos[@]} repository URLs into array"

    TOTAL_REPOS=$total
    SUCCESSFUL_REPOS=$ok
    FAILED_REPOS=$fail

    if [ "$total" -eq 0 ]; then
        log_warning "No repositories found"
        exit 0
    fi

    # Create backup
    create_backup

    # Summary
    log_success "Backup process completed!"
    log_info "Total repositories: $total"
    log_info "Successful: $ok"
    log_info "Failed: $fail"

    if [ "$fail" -gt 0 ]; then
        log_warning "Some repositories failed to process. Check error log: $ERROR_LOG"
        exit 1
    fi
}

# Run main function
main "$@"
