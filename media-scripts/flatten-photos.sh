#!/usr/bin/env bash
# Flatten Google Photos takeout directories
# Moves all nested files into the target directory, skips content duplicates,
# removes empty folders, and deletes supplemental .json metadata files.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR
readonly LOG_DIR="$SCRIPT_DIR/logs"
RUN_TS=$(date +%Y%m%d-%H%M%S)
readonly RUN_TS
readonly LOG_FILE="$LOG_DIR/flatten-photos-$RUN_TS.log"
readonly ERROR_LOG="$LOG_DIR/flatten-photos-errors-$RUN_TS.log"

DEFAULT_TARGET="$HOME/Pictures/Mobile Photos"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

TARGET_DIR=""
DRY_RUN=false
KEEP_JSON=false
MOVED=0
SKIPPED_DUPES=0
COLLISIONS=0
REMOVED_DIRS=0
DELETED_JSON=0
DEDUPED=0
HASH_FILE=""

declare -A HASH_INDEX=()

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

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [TARGET_DIR]

Flatten a Google Photos takeout (or similar nested export) into a single
directory, remove empty subdirectories, skip content duplicates, and delete
.json metadata files.

Arguments:
  TARGET_DIR    Directory to flatten (default: ${DEFAULT_TARGET})

Options:
  -n, --dry-run     Show what would happen without changing files
  -k, --keep-json   Keep .json files after flattening
  -h, --help        Show this help message

Examples:
  $(basename "$0")
  $(basename "$0") "$HOME/Pictures/Mobile Photos"
  $(basename "$0") --dry-run "$HOME/Downloads/takeout"
EOF
}

file_hash() {
    local file="$1"
    sha256sum -- "$file" | awk '{print $1}'
}

is_collision_name() {
    local name="$1"
    [[ "$name" =~ _[0-9]+(\.[^./]+)?$ ]]
}

keeper_rank() {
    local name="$1"
    local collision=1

    if ! is_collision_name "$name"; then
        collision=0
    fi

    printf '%s\t%s\n' "$collision" "$name"
}

resolve_dest() {
    local root="$1"
    local name="$2"
    local dest="$root/$name"

    if [[ ! -e "$dest" ]]; then
        printf '%s\n' "$dest"
        return 0
    fi

    local stem="$name"
    local ext=""
    if [[ "$name" == *.* && "$name" != .* ]]; then
        stem="${name%.*}"
        ext=".${name##*.}"
    fi

    local candidate=""
    local counter=1
    while :; do
        candidate="$root/${stem}_${counter}${ext}"
        if [[ ! -e "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
        counter=$((counter + 1))
    done
}

register_hash() {
    local hash="$1"
    local file="$2"
    HASH_INDEX["$hash"]="$file"
    printf '%s\t%s\n' "$hash" "$file" >> "$HASH_FILE"
}

hash_exists() {
    local hash="$1"
    [[ -n "${HASH_INDEX[$hash]:-}" ]]
}

build_hash_index() {
    local file=""
    local hash=""

    log_info "Building content hash index (existing root files)"

    while IFS= read -r -d '' file; do
        hash=$(file_hash "$file")
        if ! hash_exists "$hash"; then
            register_hash "$hash" "$file"
        else
            printf '%s\t%s\n' "$hash" "$file" >> "$HASH_FILE"
        fi
    done < <(find "$TARGET_DIR" -maxdepth 1 -type f -print0)
}

prepare_logs() {
    mkdir -p "$LOG_DIR"
    : > "$LOG_FILE"
    : > "$ERROR_LOG"
}

validate_target() {
    if [[ ! -d "$TARGET_DIR" ]]; then
        error_exit "Target directory does not exist: $TARGET_DIR"
    fi

    if [[ ! -r "$TARGET_DIR" || ! -w "$TARGET_DIR" ]]; then
        error_exit "Target directory is not readable/writable: $TARGET_DIR"
    fi
}

flatten_files() {
    local file=""
    local name=""
    local dest=""
    local hash=""

    log_info "Flattening nested files into: $TARGET_DIR"

    while IFS= read -r -d '' file; do
        hash=$(file_hash "$file")

        if hash_exists "$hash"; then
            SKIPPED_DUPES=$((SKIPPED_DUPES + 1))
            log_info "Skipping duplicate content: $file (matches ${HASH_INDEX[$hash]})"

            if [[ "$DRY_RUN" == true ]]; then
                log_info "[dry-run] rm -- $file"
            else
                rm -- "$file"
            fi
            continue
        fi

        name=$(basename -- "$file")
        dest=$(resolve_dest "$TARGET_DIR" "$name")

        if [[ "$dest" != "$TARGET_DIR/$name" ]]; then
            COLLISIONS=$((COLLISIONS + 1))
            log_warning "Name collision: $name -> $(basename -- "$dest")"
        fi

        if [[ "$DRY_RUN" == true ]]; then
            log_info "[dry-run] mv -- $file -> $dest"
        else
            mv -- "$file" "$dest"
        fi

        register_hash "$hash" "$dest"
        MOVED=$((MOVED + 1))
    done < <(find "$TARGET_DIR" -mindepth 2 -type f -print0)
}

dedupe_existing_files() {
    local hash=""
    local keeper=""
    local candidate=""
    local best_rank=""
    local candidate_rank=""

    log_info "Removing duplicate content in target directory"

    while IFS= read -r hash; do
        [[ -n "$hash" ]] || continue

        mapfile -t group < <(awk -F '\t' -v h="$hash" '$1 == h { print $2 }' "$HASH_FILE")
        if ((${#group[@]} <= 1)); then
            continue
        fi

        keeper="${group[0]}"
        best_rank=$(keeper_rank "$(basename -- "$keeper")")

        for candidate in "${group[@]:1}"; do
            candidate_rank=$(keeper_rank "$(basename -- "$candidate")")

            if [[ "$candidate_rank" < "$best_rank" ]]; then
                keeper="$candidate"
                best_rank="$candidate_rank"
            fi
        done

        for candidate in "${group[@]}"; do
            [[ "$candidate" == "$keeper" ]] && continue

            DEDUPED=$((DEDUPED + 1))
            log_info "Removing duplicate content: $candidate (keeping $(basename -- "$keeper"))"

            if [[ "$DRY_RUN" == true ]]; then
                log_info "[dry-run] rm -- $candidate"
            else
                rm -- "$candidate"
            fi
        done
    done < <(cut -f1 "$HASH_FILE" | sort -u)
}

remove_empty_dirs() {
    local removed_this_pass=0
    local pass=0

    log_info "Removing empty subdirectories"

    while :; do
        removed_this_pass=0
        pass=$((pass + 1))

        if [[ "$DRY_RUN" == true ]]; then
            while IFS= read -r -d '' dir; do
                log_info "[dry-run] rmdir -- $dir"
                removed_this_pass=$((removed_this_pass + 1))
            done < <(find "$TARGET_DIR" -mindepth 1 -depth -type d -empty -print0)
        else
            while IFS= read -r -d '' dir; do
                rmdir -- "$dir" || continue
                removed_this_pass=$((removed_this_pass + 1))
            done < <(find "$TARGET_DIR" -mindepth 1 -depth -type d -empty -print0)
        fi

        REMOVED_DIRS=$((REMOVED_DIRS + removed_this_pass))

        if [[ "$removed_this_pass" -eq 0 || "$pass" -ge 10 ]]; then
            break
        fi
    done
}

delete_json_files() {
    local json_file=""

    if [[ "$KEEP_JSON" == true ]]; then
        log_info "Skipping .json deletion (--keep-json)"
        return 0
    fi

    log_info "Deleting .json metadata files"

    while IFS= read -r -d '' json_file; do
        if [[ "$DRY_RUN" == true ]]; then
            log_info "[dry-run] rm -- $json_file"
        else
            rm -- "$json_file"
        fi
        DELETED_JSON=$((DELETED_JSON + 1))
    done < <(find "$TARGET_DIR" -maxdepth 1 -type f -iname '*.json' -print0)
}

print_summary() {
    local remaining_nested_files=0
    local remaining_nested_dirs=0
    local remaining_files=0
    local remaining_json=0

    remaining_nested_files=$(find "$TARGET_DIR" -mindepth 2 -type f 2>/dev/null | wc -l | tr -d ' ')
    remaining_nested_dirs=$(find "$TARGET_DIR" -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    remaining_files=$(find "$TARGET_DIR" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
    remaining_json=$(find "$TARGET_DIR" -maxdepth 1 -type f -iname '*.json' 2>/dev/null | wc -l | tr -d ' ')

    log_success "Flatten complete for: $TARGET_DIR"
    log_info "Moved files: $MOVED"
    log_info "Skipped duplicate content during flatten: $SKIPPED_DUPES"
    log_info "Name collisions resolved: $COLLISIONS"
    log_info "Removed duplicate content in target: $DEDUPED"
    log_info "Removed empty directories: $REMOVED_DIRS"
    log_info "Deleted .json files: $DELETED_JSON"
    log_info "Remaining root files: $remaining_files"
    log_info "Remaining nested files: $remaining_nested_files"
    log_info "Remaining nested directories: $remaining_nested_dirs"
    log_info "Remaining .json files: $remaining_json"
    log_info "Log file: $LOG_FILE"

    if [[ "$remaining_nested_files" -gt 0 || "$remaining_nested_dirs" -gt 0 ]]; then
        log_warning "Some nested paths remain; inspect the target directory manually."
        return 1
    fi

    if [[ "$KEEP_JSON" == false && "$remaining_json" -gt 0 ]]; then
        log_warning "Some .json files remain in the target directory."
        return 1
    fi
}

parse_args() {
    TARGET_DIR="$DEFAULT_TARGET"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -n | --dry-run)
                DRY_RUN=true
                shift
                ;;
            -k | --keep-json)
                KEEP_JSON=true
                shift
                ;;
            -h | --help)
                usage
                exit 0
                ;;
            --)
                shift
                break
                ;;
            -*)
                error_exit "Unknown option: $1"
                ;;
            *)
                TARGET_DIR=$1
                shift
                break
                ;;
        esac
    done

    if [[ $# -gt 0 ]]; then
        TARGET_DIR=$1
    fi

    TARGET_DIR=$(cd -- "$TARGET_DIR" && pwd)
    readonly TARGET_DIR
}

main() {
    parse_args "$@"
    prepare_logs

    HASH_FILE=$(mktemp)
    trap 'rm -f -- "$HASH_FILE"' EXIT

    if [[ "$DRY_RUN" == true ]]; then
        log_warning "Dry run enabled; no files will be changed"
    fi

    log_info "Starting photo flatten"
    validate_target
    build_hash_index
    flatten_files
    remove_empty_dirs
    dedupe_existing_files
    delete_json_files
    print_summary
}

main "$@"
