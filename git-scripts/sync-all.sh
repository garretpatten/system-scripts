#!/usr/bin/env bash
# Sync All Git Repositories
# Finds all git repositories within a given path, 
# switches to the default branch, and pulls latest changes.

set -euo pipefail

# This block provides logging functions only when the script is executed directly.
# When sourced by other scripts, they should use their own logging mechanisms.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    # Colors for output
    readonly RED='\033[0;31m'
    readonly GREEN='\033[0;32m'
    readonly YELLOW='\033[1;33m'
    readonly BLUE='\033[0;34m'
    readonly NC='\033[0m' # No Color

    log_info()    { echo -e "${BLUE}[INFO]${NC} $*" >&2; }
    log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*" >&2; }
    log_warning() { echo -e "${YELLOW}[WARNING]${NC} $*" >&2; }
    log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
else
    # When sourced, these are no-ops. Sourcing script must provide its own logging.
    log_info()    { :; }
    log_success() { :; }
    log_warning() { :; }
    log_error()   { :; }
fi

# Usage: get_default_branch
# Echos the default branch name to stdout on success, returns 1 on failure.
get_default_branch() {
    local default_branch

    # Try to get default branch from remote HEAD
    if default_branch=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|origin/||'); then
        if [[ -n "$default_branch" && "$default_branch" != "HEAD" ]]; then
            echo "$default_branch"
            return 0
        fi
    fi

    # Try to get default branch from remote show (slower)
    if default_branch=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}' 2>/dev/null); then
        if [[ -n "$default_branch" ]]; then
            echo "$default_branch"
            return 0
        fi
    fi

    # Fallback: check common branch names (local)
    for branch in main master develop; do
        if git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
            echo "$branch"
            return 0
        fi
    done

    return 1
}

# Usage: sync_repo <repo_path>
# Echos status messages to stdout/stderr. Returns 0 on success, 1 on failure.
sync_repo() {
    local repo_path="$1"
    local repo_name
    repo_name=$(basename "$repo_path")
    local original_dir
    original_dir=$(pwd)

    echo "--- Processing: $repo_name ---"

    if ! cd "$repo_path" 2>/dev/null; then
        echo "ERROR: Could not enter directory: $repo_path" >&2
        return 1
    fi

    # Skip if no remote origin
    if ! git remote get-url origin >/dev/null 2>&1; then
        echo "WARNING: No remote 'origin' found. Skipping $repo_name." >&2
        cd "$original_dir"
        return 0
    fi

    # Fetch latest remote info
    echo "INFO: Fetching latest info for $repo_name..."
    if ! git fetch origin --prune >/dev/null 2>&1; then
        echo "ERROR: Failed to fetch from origin. Skipping." >&2
        cd "$original_dir"
        return 1
    fi

    # Determine default branch
    local default_branch
    if ! default_branch=$(get_default_branch); then
        echo "ERROR: Could not determine default branch. Skipping." >&2
        cd "$original_dir"
        return 1
    fi

    echo "INFO: Default branch identified: $default_branch"

    # Check for uncommitted changes
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "WARNING: Repository has uncommitted changes. Skipping pull to avoid conflicts." >&2
        cd "$original_dir"
        return 0
    fi

    # Switch to default branch
    local current_branch
    current_branch=$(git branch --show-current)
    
    if [[ "$current_branch" != "$default_branch" ]]; then
        echo "INFO: Switching from '$current_branch' to '$default_branch'..."
        if ! git checkout "$default_branch" >/dev/null 2>&1; then
            echo "ERROR: Failed to checkout $default_branch." >&2
            cd "$original_dir"
            return 1
        fi
    fi

    # Pull latest changes
    echo "INFO: Pulling latest changes for $default_branch..."
    if git pull origin "$default_branch" >/dev/null 2>&1; then
        echo "SUCCESS: Updated $repo_name successfully."
        cd "$original_dir"
        return 0
    else
        echo "ERROR: Failed to pull changes for $repo_name." >&2
        cd "$original_dir"
        return 1
    fi
}

main() {
    local input_dir="${1:-.}"
    
    if [[ ! -d "$input_dir" ]]; then
        log_error "Directory not found: $input_dir"
        exit 1
    fi
    
    local search_dir
    search_dir=$(cd "$input_dir" && pwd)
    log_info "Searching for git repositories in: $search_dir"

    # Find all .git directories and get their parent directories
    find "$search_dir" -name ".git" -type d -prune | while read -r git_dir; do
        local repo_path
        repo_path=$(dirname "$git_dir")
        local result_output

        # Call sync_repo and capture its stdout/stderr
        result_output=$(sync_repo "$repo_path" 2>&1 || true)

        # Process the captured output for logging
        echo "$result_output" | while IFS= read -r line; do
            if [[ "$line" =~ ^---[[:space:]]Processing:.* ]]; then
                echo -e "\n${BLUE}$line${NC}"
            elif [[ "$line" =~ ^INFO:.* ]]; then
                log_info "${line#INFO: }"
            elif [[ "$line" =~ ^SUCCESS:.* ]]; then
                log_success "${line#SUCCESS: }"
            elif [[ "$line" =~ ^WARNING:.* ]]; then
                log_warning "${line#WARNING: }"
            elif [[ "$line" =~ ^ERROR:.* ]]; then
                log_error "${line#ERROR: }"
            else
                echo "$line"
            fi
        done
    done
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
