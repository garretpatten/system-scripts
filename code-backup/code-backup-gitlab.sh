#!/usr/bin/env bash
# GitHub -> GitLab.com Backup Script (mirror push)
# - Lists all non-archived GitHub repos you can access
# - Creates/updates a local mirror clone for each
# - Ensures a same-named GitLab project exists under your namespace
# - Pushes a full mirror to GitLab (all branches/tags/refs)

set -euo pipefail

# ----------------------------
# Configuration
# ----------------------------
readonly SCRIPT_DIR
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

readonly RUN_TS
RUN_TS=$( date +%Y%m%d-%H%M%S )
readonly LOG_FILE="$LOG_DIR/gh-gl-backup-$RUN_TS.log"
readonly ERROR_LOG="$LOG_DIR/gh-gl-errors-$RUN_TS.log"

# Where to store local mirror clones (bare repos)
readonly BACKUP_ROOT="${BACKUP_ROOT:-$HOME/GitHub-GitLab-Backup}"
readonly MIRRORS_DIR="$BACKUP_ROOT/mirrors-$RUN_TS"
mkdir -p "$MIRRORS_DIR"

# Required:
: "${GITLAB_TOKEN:?Set GITLAB_TOKEN (GitLab.com PAT) in env}"
: "${GITLAB_NAMESPACE:?Set GITLAB_NAMESPACE (your GitLab username or group full path) in env}"

# Optional:
# If set, script can access private GitHub repos you can see.
# Export a GitHub classic PAT with repo read access (or fine-grained equivalent).
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# If empty, we'll try to auto-detect your GitHub username from /user (needs GITHUB_TOKEN),
# otherwise we’ll prompt.
GITHUB_USERNAME="${GITHUB_USERNAME:-}"

# Prefer SSH clone from GitHub? (requires your SSH keys set up for GitHub)
# If false, use HTTPS with token injection if GITHUB_TOKEN is set.
USE_GITHUB_SSH="${USE_GITHUB_SSH:-false}"

# Create GitLab projects automatically if missing
AUTO_CREATE_GITLAB_PROJECTS="${AUTO_CREATE_GITLAB_PROJECTS:-true}"

# Default visibility for newly created GitLab projects: private/internal/public
GITLAB_VISIBILITY="${GITLAB_VISIBILITY:-private}"

# GitLab host (you said GitLab.com)
GITLAB_HOST="${GITLAB_HOST:-https://gitlab.com}"
GITLAB_API="$GITLAB_HOST/api/v4"

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
  echo -e "${ts} [${level}] ${msg}" | tee -a "$LOG_FILE"
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
  for cmd in git curl jq; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [ ${#missing[@]} -ne 0 ]; then
    error_exit "Missing dependencies: ${missing[*]} (install and retry)"
  fi
  log_success "All dependencies found"
}

# ----------------------------
# GitHub: determine username
# ----------------------------
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
    if [ -n "$login" ]; then
      GITHUB_USERNAME="$login"
      log_success "Detected GitHub username: $GITHUB_USERNAME"
      return 0
    fi
    log_warn "Could not detect GitHub username from token; will prompt."
  fi

  read -r -p "Enter your GitHub username: " GITHUB_USERNAME
  [ -n "$GITHUB_USERNAME" ] || error_exit "GitHub username is required"
  log_success "Using GitHub username: $GITHUB_USERNAME"
}

# ----------------------------
# GitHub: list repos (non-archived)
# ----------------------------
# Returns lines: "<owner>/<name>\t<clone_url>"
get_github_repos() {
  log_info "Fetching GitHub repos (excluding archived) for: $GITHUB_USERNAME"

  local page=1
  local per_page=100

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

    # Emit owner/name + url, excluding archived
    local lines
    lines="$(echo "$resp" | jq -r --argjson _ 0 \
      ".[] | select(.archived == false) | (.full_name + \"\t\" + ${jq_clone_field})" 2>>"$ERROR_LOG" || true)"

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

# ----------------------------
# GitLab helpers
# ----------------------------
urlencode() {
  # Minimal urlencode for path_with_namespace usage (spaces unlikely)
  # Encodes: / -> %2F
  echo -n "$1" | sed 's/%/%25/g; s/\//%2F/g; s/#/%23/g; s/\?/%3F/g; s/&/%26/g; s/ /%20/g'
}

gitlab_api_get() {
  local path="$1"
  curl -sS --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "$GITLAB_API$path" 2>>"$ERROR_LOG" || true
}

gitlab_api_post_json() {
  local path="$1"
  local json="$2"
  curl -sS --request POST \
    --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --header "Content-Type: application/json" \
    --data "$json" \
    "$GITLAB_API$path" 2>>"$ERROR_LOG" || true
}

get_gitlab_namespace_id() {
  # Find namespace id by searching and matching full_path exactly.
  # Works for user namespaces and groups.
  local search="$GITLAB_NAMESPACE"
  local resp
  resp="$(gitlab_api_get "/namespaces?search=$(urlencode "$search")")"
  local ns_id
  ns_id="$(echo "$resp" | jq -r --arg fp "$GITLAB_NAMESPACE" '.[] | select(.full_path==$fp) | .id' | head -n1)"
  [ -n "$ns_id" ] || return 1
  echo "$ns_id"
}

gitlab_project_exists() {
  local path_with_ns="$1" # e.g. mygroup/myrepo
  local enc; enc="$(urlencode "$path_with_ns")"
  local resp
  resp="$(gitlab_api_get "/projects/$enc")"
  # If exists, response has an "id"
  echo "$resp" | jq -e '.id? != null' >/dev/null 2>&1
}

create_gitlab_project() {
  local repo_name="$1" # just "myrepo"
  local ns_id="$2"

  local payload
  payload="$(jq -n \
    --arg name "$repo_name" \
    --argjson namespace_id "$ns_id" \
    --arg visibility "$GITLAB_VISIBILITY" \
    '{name:$name, namespace_id:$namespace_id, visibility:$visibility}')"

  local resp
  resp="$(gitlab_api_post_json "/projects" "$payload")"

  if echo "$resp" | jq -e '.id? != null' >/dev/null 2>&1; then
    return 0
  fi

  local msg
  msg="$(echo "$resp" | jq -r '.message? // .error? // empty' 2>/dev/null || true)"
  log_error "GitLab project creation failed for $repo_name: ${msg:-unknown error}"
  return 1
}

gitlab_remote_url() {
  # Use GitLab's HTTPS token auth.
  # GitLab PAT can be used as the password over HTTPS.  [oai_citation:3‡GitLab Docs](https://docs.gitlab.com/user/profile/personal_access_tokens/?utm_source=chatgpt.com)
  # The conventional form for GitLab is username "oauth2" with token as password.
  local path_with_ns="$1"
  echo "https://oauth2:${GITLAB_TOKEN}@gitlab.com/${path_with_ns}.git"
}

# ----------------------------
# Mirror clone/update and push
# ----------------------------
process_repo() {
  local full_name="$1"   # owner/name on GitHub
  local clone_url="$2"   # GitHub clone url
  local repo_name
  repo_name="$(basename "$full_name")"

  local local_path="$MIRRORS_DIR/${repo_name}.git"
  local gl_path="${GITLAB_NAMESPACE}/${repo_name}"

  log_info "Repo: $full_name  -> GitLab: $gl_path"

  # If using HTTPS to GitHub and token exists, inject it (so private clones work non-interactively)
  local effective_clone_url="$clone_url"
  if [ "$USE_GITHUB_SSH" != "true" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
    # GitHub supports token auth via x-access-token username.
    effective_clone_url="${clone_url//https:\/\//https:\/\/x-access-token:${GITHUB_TOKEN}@\/}"
  fi

  # Clone/update local mirror
  if [ -d "$local_path" ]; then
    log_info "Updating local mirror: $repo_name"
    if ! git -C "$local_path" remote update --prune 2>>"$ERROR_LOG"; then
      log_error "Failed to update mirror for $repo_name"
      return 1
    fi
  else
    log_info "Cloning local mirror: $repo_name"
    if ! git clone --mirror "$effective_clone_url" "$local_path" 2>>"$ERROR_LOG"; then
      log_error "Failed to mirror-clone $repo_name"
      return 1
    fi
  fi

  # Ensure GitLab project exists (optional auto-create)
  if gitlab_project_exists "$gl_path"; then
    log_info "GitLab project exists: $gl_path"
  else
    if [ "$AUTO_CREATE_GITLAB_PROJECTS" = "true" ]; then
      log_warn "GitLab project missing, creating: $gl_path"
      local ns_id
      ns_id="$(get_gitlab_namespace_id)" || {
        log_error "Could not resolve GitLab namespace id for: $GITLAB_NAMESPACE"
        return 1
      }
      create_gitlab_project "$repo_name" "$ns_id" || return 1
      log_success "Created GitLab project: $gl_path"
    else
      log_warn "GitLab project missing and AUTO_CREATE_GITLAB_PROJECTS=false; skipping push: $repo_name"
      return 0
    fi
  fi

  # Push mirror to GitLab
  local gl_url
  gl_url="$(gitlab_remote_url "$gl_path")"

  # Avoid printing token-bearing URL
  log_info "Pushing mirror to GitLab (all refs): $gl_path"
  if ! git -C "$local_path" push --mirror "$gl_url" 2>>"$ERROR_LOG"; then
    log_error "Failed to push mirror to GitLab for $repo_name"
    return 1
  fi

  log_success "Backed up to GitLab: $gl_path"
  return 0
}

# ----------------------------
# Main
# ----------------------------
main() {
  log_info "Starting GitHub -> GitLab backup"
  log_info "Local mirrors dir: $MIRRORS_DIR"
  log_info "Log: $LOG_FILE"
  log_info "Errors: $ERROR_LOG"

  check_dependencies
  get_github_username

  local ns_id=""
  if [ "$AUTO_CREATE_GITLAB_PROJECTS" = "true" ]; then
    ns_id="$(get_gitlab_namespace_id)" || error_exit "Could not find GitLab namespace: $GITLAB_NAMESPACE"
    log_success "Resolved GitLab namespace id: $ns_id"
  fi

  local total=0 ok=0 fail=0

  # Stream repos line-by-line
  while IFS=$'\t' read -r full_name clone_url; do
    [ -n "${full_name:-}" ] || continue
    [ -n "${clone_url:-}" ] || continue
    total=$((total + 1))

    if process_repo "$full_name" "$clone_url"; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
    fi
  done < <(get_github_repos)

  log_success "Done."
  log_info "Total repos processed: $total"
  log_info "Successful: $ok"
  log_info "Failed: $fail"

  if [ "$fail" -gt 0 ]; then
    log_warn "Some repos failed. See: $ERROR_LOG"
    exit 1
  fi
}

main "$@"
