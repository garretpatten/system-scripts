#!/usr/bin/env bash
# Notion Workspace Markdown Export Script
# Exports all pages and databases accessible to the integration as Markdown
# files in nested folders that mirror the Notion workspace structure.

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
readonly LOG_FILE="$LOG_DIR/notion-backup-$RUN_TS.log"
readonly ERROR_LOG="$LOG_DIR/notion-errors-$RUN_TS.log"

# Required:
: "${NOTION_API_TOKEN:?Set NOTION_API_TOKEN in env or .env}"

# Backup directory and archive
EXPORT_DATE=$(date +%Y-%m-%d)
readonly EXPORT_DATE
readonly EXPORT_DIR_NAME="Notion-Export_${EXPORT_DATE}"
readonly EXPORT_DIR="$HOME/$EXPORT_DIR_NAME"
readonly EXPORT_ZIP="$HOME/${EXPORT_DIR_NAME}.zip"

# Notion API
readonly NOTION_API="https://api.notion.com/v1"
readonly NOTION_VERSION="2022-06-28"

# Delay between API requests to respect Notion's rate limits (req/sec).
readonly NOTION_RATE_LIMIT_DELAY="${NOTION_RATE_LIMIT_DELAY:-0.35}"

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
# Notion API helpers
# ----------------------------
notion_api_get() {
    local path="$1"
    local resp
    local curl_exit=0
    resp=$(curl -sS -f \
        --header "Authorization: Bearer $NOTION_API_TOKEN" \
        --header "Notion-Version: $NOTION_VERSION" \
        "$NOTION_API$path" 2>>"$ERROR_LOG") || curl_exit=$?
    sleep "$NOTION_RATE_LIMIT_DELAY"
    echo "$resp"
    return "$curl_exit"
}

notion_api_post() {
    local path="$1"
    local payload="$2"
    local resp
    local curl_exit=0
    resp=$(curl -sS -f \
        --request POST \
        --header "Authorization: Bearer $NOTION_API_TOKEN" \
        --header "Notion-Version: $NOTION_VERSION" \
        --header "Content-Type: application/json" \
        --data "$payload" \
        "$NOTION_API$path" 2>>"$ERROR_LOG") || curl_exit=$?
    sleep "$NOTION_RATE_LIMIT_DELAY"
    echo "$resp"
    return "$curl_exit"
}

# Search for all pages and databases the integration can access.
search_all() {
    local cursor=""
    while true; do
        local payload
        if [ -z "$cursor" ]; then
            payload='{"page_size":100}'
        else
            payload=$(jq -n --arg cursor "$cursor" '{page_size:100, start_cursor:$cursor}')
        fi

        local resp
        if ! resp="$(notion_api_post "/search" "$payload")"; then
            error_exit "Notion API search request failed"
        fi

        if ! echo "$resp" | jq -e . >/dev/null 2>&1; then
            error_exit "Notion API returned non-JSON response on /search"
        fi

        if echo "$resp" | jq -e '.object? // .status? // .message? // .code? // empty' >/dev/null 2>&1; then
            local msg
            msg="$(echo "$resp" | jq -r '.message? // .status? // "unknown"' 2>/dev/null)"
            error_exit "Notion API error on /search: $msg"
        fi

        echo "$resp" | jq -c '.results[]'

        cursor="$(echo "$resp" | jq -r '.next_cursor // empty')"
        [ -z "$cursor" ] && break
    done
}

# Query all entries in a database.
query_database() {
    local db_id="$1"
    local cursor=""
    while true; do
        local payload
        if [ -z "$cursor" ]; then
            payload='{"page_size":100}'
        else
            payload=$(jq -n --arg cursor "$cursor" '{page_size:100, start_cursor:$cursor}')
        fi

        local resp
        if ! resp="$(notion_api_post "/v1/databases/$db_id/query" "$payload")"; then
            log_warn "Notion API query failed for database $db_id"
            echo "[]"
            return 1
        fi

        echo "$resp" | jq -c '.results[]'

        cursor="$(echo "$resp" | jq -r '.next_cursor // empty')"
        [ -z "$cursor" ] && break
    done
}

# ----------------------------
# Object map and paths
# ----------------------------
# Associative arrays for workspace structure.
declare -A OBJ_TITLE
declare -A OBJ_TYPE
declare -A OBJ_PARENT

# Sanitize a Notion title for use as a filename or directory name.
sanitize_filename() {
    local name="$1"
    name=${name//\//-}
    name=${name//\\/-}
    name=${name//$'\n'/ }
    name=${name//$'\r'/ }
    name=$(printf '%s' "$name" | tr -d '\000-\031')
    name=$(printf '%s' "$name" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [ -z "$name" ]; then
        name="Untitled"
    fi
    printf '%s' "$name"
}

# Build a tab-separated map of id, title, type, parent_id.
build_object_map() {
    local input_file="$1"
    while IFS= read -r obj; do
        local id type parent_id title
        id="$(echo "$obj" | jq -r '.id')"
        type="$(echo "$obj" | jq -r '.object')"
        parent_id="$(echo "$obj" | jq -r '
            if .parent.page_id then .parent.page_id
            elif .parent.database_id then .parent.database_id
            elif .parent.block_id then .parent.block_id
            else ""
            end
        ')"

        if [ "$type" = "page" ]; then
            title="$(echo "$obj" | jq -r '[.properties | to_entries[] | select(.value.type == "title") | .value.title[].plain_text] | add // "Untitled"')"
        else
            title="$(echo "$obj" | jq -r '[.title[].plain_text] | add // "Untitled"')"
        fi

        printf '%s\t%s\t%s\t%s\n' "$id" "$title" "$type" "$parent_id"
    done < "$input_file"
}

load_object_map() {
    local map_file="$1"
    while IFS=$'\t' read -r id title type parent_id; do
        OBJ_TITLE["$id"]="$title"
        OBJ_TYPE["$id"]="$type"
        OBJ_PARENT["$id"]="$parent_id"
    done < "$map_file"
}

# Return the directory path (relative to EXPORT_DIR) for an object's ancestors.
get_parent_path() {
    local id="$1"
    local path=""
    local current="${OBJ_PARENT[$id]:-}"
    local visited=()

    while [ -n "$current" ] && [ "${OBJ_TYPE[$current]+isset}" ]; do
        if [[ " ${visited[*]} " == *" $current "* ]]; then
            break
        fi
        visited+=("$current")

        local title
        title="$(sanitize_filename "${OBJ_TITLE[$current]:-Untitled}")"
        if [ -n "$path" ]; then
            path="$title/$path"
        else
            path="$title"
        fi
        current="${OBJ_PARENT[$current]:-}"
    done

    echo "$path"
}

unique_file_path() {
    local dir="$1"
    local base="$2"
    local ext="$3"
    local path="$dir/$base$ext"
    if [ ! -e "$path" ]; then
        echo "$path"
        return
    fi
    local counter=1
    while [ -e "$dir/${base}_${counter}$ext" ]; do
        counter=$((counter + 1))
    done
    echo "$dir/${base}_${counter}$ext"
}

# ----------------------------
# Markdown conversion
# ----------------------------
block_to_markdown() {
    local block="$1"
    local indent="$2"

    echo "$block" | jq -r --arg indent "$indent" '
        . as $block |
        ($block.type) as $type |
        def rt:
            if . == null or length == 0 then ""
            else
                [.[] |
                    (if .annotations.bold then "**" else "" end) +
                    (if .annotations.italic then "*" else "" end) +
                    (if .annotations.strikethrough then "~~" else "" end) +
                    (if .annotations.code then "`" else "" end) +
                    (if .href then "[" + .plain_text + "](" + .href + ")" else .plain_text end) +
                    (if .annotations.code then "`" else "" end) +
                    (if .annotations.strikethrough then "~~" else "" end) +
                    (if .annotations.italic then "*" else "" end) +
                    (if .annotations.bold then "**" else "" end)
                ] | add
            end
        ;
        def lines_rt:
            if . == null or length == 0 then ""
            else
                (rt | split("\n") | .[]) as $line |
                $line
            end
        ;
        if $type == "paragraph" then
            if ($block.paragraph.rich_text | rt) == "" then ""
            else "\($indent)\($block.paragraph.rich_text | rt)"
            end
        elif $type == "heading_1" then "\($indent)# \($block.heading_1.rich_text | rt)"
        elif $type == "heading_2" then "\($indent)## \($block.heading_2.rich_text | rt)"
        elif $type == "heading_3" then "\($indent)### \($block.heading_3.rich_text | rt)"
        elif $type == "bulleted_list_item" then "\($indent)- \($block.bulleted_list_item.rich_text | rt)"
        elif $type == "numbered_list_item" then "\($indent)1. \($block.numbered_list_item.rich_text | rt)"
        elif $type == "to_do" then "\($indent)- [\($block.to_do.checked | if . then "x" else " " end)] \($block.to_do.rich_text | rt)"
        elif $type == "code" then
            "\($indent)```\($block.code.language // "")",
            ($block.code.rich_text | lines_rt | "\($indent)\(.)"),
            "\($indent)```"
        elif $type == "quote" then
            ($block.quote.rich_text | lines_rt | "\($indent)> \(.)")
        elif $type == "divider" then "\($indent)---"
        elif $type == "callout" then
            ($block.callout.rich_text | lines_rt | "\($indent)> \(.)"),
            (if ($block.callout.icon // null) != null then "\($indent)> _(icon: \($block.callout.icon.emoji // $block.callout.icon.type))_" else empty end)
        elif $type == "toggle" then
            # Toggle structure is ignored; children are processed recursively.
            ""
        elif $type == "child_page" then
            "\($indent)*Child page: \($block.child_page.title // $block.id)*"
        elif $type == "child_database" then
            "\($indent)*Child database: \($block.child_database.title // $block.id)*"
        elif $type == "link_to_page" then
            if $block.link_to_page.type == "page_id" then "\($indent)*Linked page: \($block.link_to_page.page_id)*"
            elif $block.link_to_page.type == "database_id" then "\($indent)*Linked database: \($block.link_to_page.database_id)*"
            else "\($indent)*Linked page*"
            end
        elif $type == "bookmark" then "\($indent)*Bookmark: \($block.bookmark.url // "")*"
        elif $type == "image" then
            if $block.image.type == "external" then "\($indent)![\($block.image.caption | rt)](\($block.image.external.url))"
            elif $block.image.type == "file" then "\($indent)*Image: \($block.image.file.url // "")*"
            else "\($indent)*Image*"
            end
        else "\($indent)<!-- unsupported block type: \($type) -->"
        end
    '
}

# Recursively fetch and convert a block's children to Markdown.
convert_blocks() {
    local block_id="$1"
    local indent="$2"
    local depth="$3"

    if [ "$depth" -gt 10 ]; then
        return 0
    fi

    local resp
    if ! resp="$(notion_api_get "/v1/blocks/$block_id/children")"; then
        log_warn "Failed to fetch children for block $block_id"
        return 1
    fi

    local cursor has_more
    has_more="$(echo "$resp" | jq -r '.has_more')"
    cursor="$(echo "$resp" | jq -r '.next_cursor // empty')"

    process_block_page "$resp" "$indent" "$depth"

    while [ "$has_more" = "true" ] && [ -n "$cursor" ]; do
        if ! resp="$(notion_api_get "/v1/blocks/$block_id/children?start_cursor=$cursor")"; then
            log_warn "Failed to fetch paginated children for block $block_id"
            break
        fi
        has_more="$(echo "$resp" | jq -r '.has_more')"
        cursor="$(echo "$resp" | jq -r '.next_cursor // empty')"
        process_block_page "$resp" "$indent" "$depth"
    done
}

process_block_page() {
    local resp="$1"
    local indent="$2"
    local depth="$3"

    echo "$resp" | jq -c '.results[]' | while IFS= read -r block; do
        local type has_children child_id child_indent
        type="$(echo "$block" | jq -r '.type')"
        has_children="$(echo "$block" | jq -r '.has_children')"

        block_to_markdown "$block" "$indent"

        if [ "$has_children" = "true" ]; then
            child_id="$(echo "$block" | jq -r '.id')"
            child_indent="$indent"
            case "$type" in
                bulleted_list_item|numbered_list_item|to_do|quote|callout)
                    child_indent="${indent}  "
                    ;;
                toggle)
                    # Toggle nesting is ignored, so keep the same indent.
                    child_indent="$indent"
                    ;;
            esac
            convert_blocks "$child_id" "$child_indent" $((depth + 1))
        fi
    done
}

# ----------------------------
# Exporters
# ----------------------------
export_page() {
    local page_id="$1"
    local title="$2"
    local output_file="$3"

    {
        echo "# $title"
        echo ""
        convert_blocks "$page_id" "" 0
    } > "$output_file"
}

export_database() {
    local db_id="$1"
    local title="$2"
    local output_file="$3"

    local db_info
    if ! db_info="$(notion_api_get "/v1/databases/$db_id")"; then
        log_warn "Failed to fetch database: $title"
        return 1
    fi

    local rows_json
    rows_json=$(query_database "$db_id" | jq -s '.')

    jq -n \
        --arg title "$title" \
        --argjson db "$db_info" \
        --argjson rows "$rows_json" \
        '
        def pv:
            if . == null or .type == null then ""
            elif .type == "title" then (.title // [] | map(.plain_text) | join(""))
            elif .type == "rich_text" then (.rich_text // [] | map(.plain_text) | join(""))
            elif .type == "number" then (.number // "" | tostring)
            elif .type == "select" then (.select.name // "")
            elif .type == "multi_select" then (.multi_select // [] | map(.name) | join("; "))
            elif .type == "status" then (.status.name // "")
            elif .type == "date" then ((.date.start // "") + (if (.date.end // null) != null then " to " + .date.end else "" end))
            elif .type == "formula" then
                if .formula.type == "string" then (.formula.string // "")
                elif .formula.type == "number" then (.formula.number // "" | tostring)
                elif .formula.type == "boolean" then (.formula.boolean // false | tostring)
                elif .formula.type == "date" then (.formula.date.start // "")
                else ""
                end
            elif .type == "relation" then (.relation // [] | map(.id) | join("; "))
            elif .type == "rollup" then (.rollup.array // [] | map(pv) | join("; "))
            elif .type == "people" then (.people // [] | map(.name // .id) | join("; "))
            elif .type == "files" then (.files // [] | map(.name // .file.url // .external.url) | join("; "))
            elif .type == "checkbox" then (.checkbox // false | tostring)
            elif .type == "url" then (.url // "")
            elif .type == "email" then (.email // "")
            elif .type == "phone_number" then (.phone_number // "")
            elif .type == "created_by" then (.created_by.name // .created_by.id // "")
            elif .type == "created_time" then (.created_time // "")
            elif .type == "last_edited_by" then (.last_edited_by.name // .last_edited_by.id // "")
            elif .type == "last_edited_time" then (.last_edited_time // "")
            else (. | tostring)
            end
        ;
        "# " + $title,
        "",
        (($db.description // [] | map(.plain_text) | join("")) | if length > 0 then ., "", "" else empty end),
        (if ($rows | length) == 0 then "_No entries._"
         else
           $rows[] as $row |
           (($row.properties | to_entries[] | select(.value.type == "title") | .value.title[].plain_text) | add // "Untitled") as $entry_title |
           "",
           "## " + $entry_title,
           "",
           ($db.properties | keys_unsorted[] as $pn |
             "- **" + $pn + "**: " + ($row.properties[$pn] | pv))
         end)
        ' > "$output_file"
}

# ----------------------------
# Backup creation
# ----------------------------
setup_directories() {
    mkdir -p "$LOG_DIR" || {
        echo "Error: Failed to create log directory: $LOG_DIR" >&2
        exit 1
    }

    if [ -d "$EXPORT_DIR" ]; then
        log_info "Removing previous export directory: $EXPORT_DIR"
        rm -rf "$EXPORT_DIR"
    fi

    mkdir -p "$EXPORT_DIR" || {
        log_error "Failed to create export directory: $EXPORT_DIR"
        exit 1
    }
}

create_backup() {
    log_info "Creating Notion export zip..."

    local original_dir
    original_dir=$(pwd)
    cd "$HOME" || error_exit "Failed to change to home directory"

    if zip -r "$EXPORT_ZIP" "$EXPORT_DIR_NAME" -x "*.DS_Store" "*.log" 2>>"$ERROR_LOG"; then
        log_success "Export created successfully: $EXPORT_ZIP"
        log_info "Export size: $(du -h "$EXPORT_ZIP" | cut -f1)"
    else
        error_exit "Failed to create export zip file"
    fi

    cd "$original_dir" || error_exit "Failed to return to original directory"
}

# ----------------------------
# Main
# ----------------------------
main() {
    setup_directories

    log_info "Starting Notion Workspace Export"
    log_info "Export directory: $EXPORT_DIR"
    log_info "Log: $LOG_FILE"
    log_info "Errors: $ERROR_LOG"

    check_dependencies

    log_info "Discovering pages and databases..."
    local all_objects_file
    all_objects_file="$(mktemp)"
    search_all > "$all_objects_file"
    local total_count
    total_count="$(wc -l < "$all_objects_file" | tr -d ' ')"
    log_info "Found $total_count accessible objects"

    if [ "$total_count" -eq 0 ]; then
        log_warn "No pages or databases found. Ensure your Notion integration has been added to your workspace content."
        rm -f "$all_objects_file"
        exit 0
    fi

    log_info "Building workspace structure..."
    local map_file
    map_file="$(mktemp)"
    build_object_map "$all_objects_file" > "$map_file"
    load_object_map "$map_file"

    local exported_pages=0
    local exported_databases=0

    while IFS=$'\t' read -r id title type parent_id; do
        local parent_path target_dir safe_title output_file
        parent_path="$(get_parent_path "$id")"
        target_dir="$EXPORT_DIR/$parent_path"
        mkdir -p "$target_dir"

        safe_title="$(sanitize_filename "$title")"

        if [ "$type" = "page" ]; then
            output_file="$(unique_file_path "$target_dir" "$safe_title" ".md")"
            log_info "Exporting page: $title -> $output_file"
            if export_page "$id" "$title" "$output_file"; then
                exported_pages=$((exported_pages + 1))
            else
                log_warn "Failed to export page: $title"
            fi
        elif [ "$type" = "database" ]; then
            output_file="$(unique_file_path "$target_dir" "$safe_title" ".md")"
            log_info "Exporting database: $title -> $output_file"
            if export_database "$id" "$title" "$output_file"; then
                exported_databases=$((exported_databases + 1))
            else
                log_warn "Failed to export database: $title"
            fi
        fi
    done < "$map_file"

    create_backup

    rm -rf "$EXPORT_DIR"
    rm -f "$all_objects_file" "$map_file"

    log_success "Notion export completed!"
    log_info "Pages exported: $exported_pages"
    log_info "Databases exported: $exported_databases"
    log_info "Archive: $EXPORT_ZIP"
}

main "$@"
