#!/bin/bash

set -euo pipefail

PROJECTS_DIR="$HOME/Projects"
BACKUP_DIR="$HOME/Projects-Backup"

# Create backup dir if it doesn't exist, or clear it if it does
if [ -d "$BACKUP_DIR" ]; then
    echo "Clearing existing backup directory..."
    rm -rf "$BACKUP_DIR"
fi
mkdir -p "$BACKUP_DIR"

echo "Starting backup process..."

for repo in "$PROJECTS_DIR"/*; do
    if [ -d "$repo/.git" ]; then
        echo "Processing repository: $(basename "$repo")"
        cd "$repo"

        # Fetch the latest from origin
        git fetch origin

        # Determine default branch (main, master, or fallback)
        DEFAULT_BRANCH=$(git remote show origin | awk '/HEAD branch/ {print $NF}')
        if [ -z "$DEFAULT_BRANCH" ]; then
            # Fallback if remote info fails
            if git show-ref --verify --quiet refs/heads/main; then
                DEFAULT_BRANCH="main"
            elif git show-ref --verify --quiet refs/heads/master; then
                DEFAULT_BRANCH="master"
            elif git show-ref --verify --quiet refs/heads/release; then
                DEFAULT_BRANCH="release"
            else
                echo "Warning: Could not determine default branch for $repo"
                cd - > /dev/null
                continue
            fi
        fi

        # Checkout and pull the default branch
        git checkout "$DEFAULT_BRANCH"
        git pull origin "$DEFAULT_BRANCH"

        # Now copy the working directory to the backup directory
        DEST="$BACKUP_DIR/$(basename "$repo")"
        echo "Copying updated repo to backup: $DEST"
        rsync -a --exclude=".git" ./ "$DEST"

        cd - > /dev/null
    else
        echo "Skipping non-git directory: $repo"
    fi
done

if [[ ! -f "$HOME/Projects-Backup/.DS_Store" ]]; then
	rm "$HOME/Projects-Backup/.DS_Store"
fi

echo "✅ Backup complete. All repositories have been updated and copied to the backup directory."
