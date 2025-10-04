#!/bin/bash

# GitHub Projects Backup Script
# Backs up all GitHub repositories for a user by cloning/updating them and creating a timestamped zip backup

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECTS_DIR="$HOME/Projects"
readonly LOG_DIR="$SCRIPT_DIR/logs"
readonly LOG_FILE="$LOG_DIR/code-backup-$(date +%Y%m%d-%H%M%S).log"
readonly ERROR_LOG="$LOG_DIR/errors-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Global variables
GITHUB_USERNAME=""
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
    log_info "Getting GitHub username..."

    # Try to get from git remote if available (most reliable)
    GITHUB_USERNAME=$(git config --get remote.origin.url 2>/dev/null | sed -n 's/.*github\.com[:/]\([^/]*\).*/\1/p' || echo "")

    if [ -z "$GITHUB_USERNAME" ]; then
        # Try to get from GitHub API (requires authentication)
        GITHUB_USERNAME=$(curl -s https://api.github.com/user 2>/dev/null | jq -r '.login' 2>/dev/null || echo "")
    fi

    if [ -z "$GITHUB_USERNAME" ] || [ "$GITHUB_USERNAME" = "null" ]; then
        read -p "Please enter your GitHub username: " GITHUB_USERNAME
        if [ -z "$GITHUB_USERNAME" ]; then
            error_exit "GitHub username is required"
        fi
    fi

    log_success "Using GitHub username: $GITHUB_USERNAME"
}

# Create necessary directories
setup_directories() {
    echo "Setting up directories..."

    # Create Projects directory
    if [ ! -d "$PROJECTS_DIR" ]; then
        echo "Creating Projects directory: $PROJECTS_DIR"
        mkdir -p "$PROJECTS_DIR" || {
            echo "Error: Failed to create Projects directory"
            exit 1
        }
    fi

    # Create log directory
    if [ ! -d "$LOG_DIR" ]; then
        echo "Creating log directory: $LOG_DIR"
        mkdir -p "$LOG_DIR" || {
            echo "Error: Failed to create log directory"
            exit 1
        }
    fi

    echo "Directories set up successfully"
}

# Get all GitHub repositories
get_github_repos() {
    log_info "Fetching GitHub repositories for user: $GITHUB_USERNAME" >&2

    local page=1
    local per_page=100
    local all_repos=()

    while true; do
        log_info "Fetching page $page..." >&2

        # Use the user-specific endpoint instead of /user/repos
        local url="https://api.github.com/users/$GITHUB_USERNAME/repos?page=$page&per_page=$per_page&type=all&sort=updated"
        local response
        local repos

        if ! response=$(curl -s "$url" 2>/dev/null); then
            error_exit "Failed to fetch repositories from GitHub API"
        fi

        # Check if we got an error response
        if echo "$response" | jq -e '.message' >/dev/null 2>&1; then
            local error_msg=$(echo "$response" | jq -r '.message')
            error_exit "GitHub API error: $error_msg"
        fi

        if ! repos=$(echo "$response" | jq -r '.[].clone_url' 2>/dev/null); then
            error_exit "Failed to parse repository data from GitHub API"
        fi

        if [ -z "$repos" ] || [ "$repos" = "null" ]; then
            break
        fi

        while IFS= read -r repo_url; do
            if [ -n "$repo_url" ] && [ "$repo_url" != "null" ]; then
                all_repos+=("$repo_url")
            fi
        done <<< "$repos"

        # Check if we got fewer repos than requested (last page)
        local repo_count=$(echo "$repos" | wc -l)
        if [ "$repo_count" -lt "$per_page" ]; then
            break
        fi

        ((page++))
    done

    TOTAL_REPOS=${#all_repos[@]}
    log_success "Found $TOTAL_REPOS repositories" >&2

    # Return the array to stdout only
    printf '%s\n' "${all_repos[@]}"
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

    if git clone "$repo_url" "$repo_path" 2>>"$ERROR_LOG"; then
        log_success "Successfully cloned: $repo_name"
        ((SUCCESSFUL_REPOS++))

        # Checkout default branch
        cd "$repo_path" || return 1
        local default_branch
        if default_branch=$(get_default_branch "$repo_url" "$repo_name"); then
            git checkout "$default_branch" 2>>"$ERROR_LOG" || log_warning "Could not checkout $default_branch for $repo_name"
        fi
        cd - > /dev/null || return 1
    else
        log_error "Failed to clone: $repo_name"
        ((FAILED_REPOS++))
    fi
}

# Update an existing repository
update_repository() {
    local repo_path="$1"
    local repo_name="$2"

    cd "$repo_path" || return 1

    # Fetch latest changes
    if ! git fetch origin 2>>"$ERROR_LOG"; then
        log_error "Failed to fetch updates for: $repo_name"
        ((FAILED_REPOS++))
        cd - > /dev/null || return 1
        return 1
    fi

    # Get current branch
    local current_branch
    current_branch=$(git branch --show-current 2>/dev/null || echo "")

    # Get default branch
    local default_branch
    if ! default_branch=$(get_default_branch "" "$repo_name"); then
        log_warning "Could not determine default branch for $repo_name, skipping"
        ((FAILED_REPOS++))
        cd - > /dev/null || return 1
        return 1
    fi

    # Switch to default branch if not already on it
    if [ "$current_branch" != "$default_branch" ]; then
        log_info "Switching to default branch: $default_branch"
        if ! git checkout "$default_branch" 2>>"$ERROR_LOG"; then
            log_error "Failed to checkout $default_branch for $repo_name"
            ((FAILED_REPOS++))
            cd - > /dev/null || return 1
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

    cd - > /dev/null || return 1
}

# Create backup zip file
create_backup() {
    log_info "Creating backup zip file..."

    local timestamp=$(date +%Y-%m-%d_%H-%M-%S)
    local backup_name="Projects-Backup_${timestamp}.zip"
    local backup_path="$HOME/$backup_name"

    # Change to Projects directory parent to maintain directory structure in zip
    local original_dir=$(pwd)
    cd "$(dirname "$PROJECTS_DIR")" || error_exit "Failed to change to Projects parent directory"

    if zip -r "$backup_path" "$(basename "$PROJECTS_DIR")" -x "*.git/*" "*.DS_Store" "*.log" 2>>"$ERROR_LOG"; then
        log_success "Backup created successfully: $backup_path"
        log_info "Backup size: $(du -h "$backup_path" | cut -f1)"
    else
        error_exit "Failed to create backup zip file"
    fi

    cd "$original_dir" || error_exit "Failed to return to original directory"
}

# Main function
main() {
    # Setup directories first before any logging
    setup_directories

    log_info "Starting GitHub Projects Backup Script"
    log_info "Log file: $LOG_FILE"
    log_info "Error log: $ERROR_LOG"

    # Continue with other setup
    check_dependencies
    get_github_username

    # Get all repositories
    local repos=()
    while IFS= read -r repo_url; do
        if [ -n "$repo_url" ] && [[ "$repo_url" =~ ^https://github\.com/ ]]; then
            repos+=("$repo_url")
        fi
    done < <(get_github_repos)

    if [ ${#repos[@]} -eq 0 ]; then
        log_warning "No repositories found"
        exit 0
    fi

    # Process each repository
    log_info "Processing $TOTAL_REPOS repositories..."
    for repo_url in "${repos[@]}"; do
        process_repository "$repo_url"
    done

    # Create backup
    create_backup

    # Summary
    log_success "Backup process completed!"
    log_info "Total repositories: $TOTAL_REPOS"
    log_info "Successful: $SUCCESSFUL_REPOS"
    log_info "Failed: $FAILED_REPOS"

    if [ $FAILED_REPOS -gt 0 ]; then
        log_warning "Some repositories failed to process. Check error log: $ERROR_LOG"
    fi
}

# Run main function
main "$@"
