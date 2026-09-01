#!/usr/bin/env bash
# Thin wrapper around the TypeScript Obsidian notes backup implementation.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

cd "$PROJECT_ROOT"
npx tsx backups/src/obsidian-notes-backup.ts
