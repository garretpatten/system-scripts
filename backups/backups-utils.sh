#!/usr/bin/env bash
# Shared utilities for backup scripts.
# This file is meant to be sourced, not executed directly.

# Load a .env file from the project root without overriding variables that are
# already exported in the current shell.
load_env_file() {
    local script_dir
    script_dir=$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)
    local project_root
    project_root=$(cd "$script_dir/.." && pwd)
    local env_file="$project_root/.env"

    if [ ! -f "$env_file" ]; then
        return 0
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        # Remove leading and trailing whitespace
        line="${line#"${line%%[![:space:]]*}"}"
        line="${line%"${line##*[![:space:]]}"}"

        # Skip empty lines and comments
        [[ -z "$line" ]] && continue
        [[ "$line" =~ ^[[:space:]]*# ]] && continue

        # Parse KEY=VALUE
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"

            # Strip matching surrounding quotes
            if [[ "$value" =~ ^\"(.*)\"$ ]]; then
                value="${BASH_REMATCH[1]}"
            elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
                value="${BASH_REMATCH[1]}"
            fi

            # Only set if not already present in the environment
            if [ -z "${!key:-}" ]; then
                export "$key=$value"
            fi
        fi
    done < "$env_file"
}
