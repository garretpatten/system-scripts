#!/usr/bin/env bash
# Thin wrapper around the TypeScript Chrome bookmarks backup implementation.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

cd "$PROJECT_ROOT"
npx tsx backups/src/chrome-bookmarks-backup.ts
