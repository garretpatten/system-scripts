#!/bin/bash

set -euo pipefail

PROJECTS_DIR="$HOME/Projects"
DATESTAMP=$(date +%F)  # YYYY-MM-DD
BACKUP_DIR="$HOME/Projects-Backup-$DATESTAMP"

echo "📁 Source: $PROJECTS_DIR"
echo "💾 Backup: $BACKUP_DIR"

# Create backup dir
mkdir -p "$BACKUP_DIR"

echo "🚀 Starting backup process..."

for repo in "$PROJECTS_DIR"/*; do
    if [ -d "$repo/.git" ]; then
        REPO_NAME=$(basename "$repo")
        echo "🔄 Processing repository: $REPO_NAME"

        pushd "$repo" > /dev/null

        # Fetch latest
        git fetch origin

        # Determine default branch
        DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}')
        if [ -z "$DEFAULT_BRANCH" ]; then
            if git show-ref --verify --quiet refs/heads/main; then
                DEFAULT_BRANCH="main"
            elif git show-ref --verify --quiet refs/heads/master; then
                DEFAULT_BRANCH="master"
            elif git show-ref --verify --quiet refs/heads/release; then
                DEFAULT_BRANCH="release"
            else
                echo "⚠️  Skipping $REPO_NAME: no valid default branch found."
                popd > /dev/null
                continue
            fi
        fi

        git checkout "$DEFAULT_BRANCH"
        git pull origin "$DEFAULT_BRANCH"

        # Copy to backup dir
        DEST="$BACKUP_DIR/$REPO_NAME"
        mkdir -p "$DEST"
        echo "📦 Copying to $DEST"
        rsync -a --exclude=".git" ./ "$DEST"

        popd > /dev/null
    else
        echo "⏭ Skipping non-git directory: $(basename "$repo")"
    fi
done

# Cleanup .DS_Store if somehow copied
find "$BACKUP_DIR" -name ".DS_Store" -type f -delete

echo "✅ Backup complete: $BACKUP_DIR"
