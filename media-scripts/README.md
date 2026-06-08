# Media Scripts

Utilities for organizing exported photo libraries, especially Google Photos
takeout archives with deeply nested folders and supplemental metadata files.

## `flatten-photos.sh`

Recursively flattens a directory tree into a single folder:

1. Moves every nested file into the target directory
2. Skips files whose content already exists (SHA-256 match)
3. Resolves remaining filename collisions by appending `_1`, `_2`, etc.
4. Deletes empty subdirectories
5. Removes duplicate content already present in the target directory
6. Removes `.json` metadata files from the target directory

### Requirements

- `bash` 4.0+
- Standard Unix tools: `find`, `mv`, `rm`, `mkdir`

### Usage

```bash
chmod +x media-scripts/flatten-photos.sh

# Default target: ~/Pictures/Mobile Photos
./media-scripts/flatten-photos.sh

# Custom directory
./media-scripts/flatten-photos.sh "$HOME/Downloads/takeout-folder"

# Preview changes without modifying files
./media-scripts/flatten-photos.sh --dry-run "$HOME/Pictures/Mobile Photos"

# Keep .json metadata files
./media-scripts/flatten-photos.sh --keep-json "$HOME/Pictures/Mobile Photos"
```

### Options

| Option | Description |
| --- | --- |
| `-n`, `--dry-run` | Print planned moves/deletions without changing files |
| `-k`, `--keep-json` | Skip deletion of `.json` files after flattening |
| `-h`, `--help` | Show usage information |

### Logging

Each run writes timestamped logs under `media-scripts/logs/`:

- `flatten-photos-YYYYMMDD-HHMMSS.log`
- `flatten-photos-errors-YYYYMMDD-HHMMSS.log`

### Notes

- The script only deletes `.json` files at the top level of the target
  directory after flattening completes.
- Video files (`.mp4`, `.mov`, etc.) are kept; only `.json` metadata is
  removed by default.
- Run with `--dry-run` first when pointing at a new takeout export.
