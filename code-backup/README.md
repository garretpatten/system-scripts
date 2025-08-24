# GitHub Projects Backup Script

This script backs up all Git repositories located in your `~/Projects` directory by:

- Pulling the latest changes from each repository's default branch (e.g. `main`, `master`, or `release`)
- Copying each updated repository (excluding `.git`) into a dated backup directory: `~/Projects-Backup-YYYY-MM-DD`

---

## 🛠 Requirements

- Bash shell
- `git` CLI
- `rsync`

---

## 📦 Directory Structure

```text
~/Projects/
├── repo-a/
├── repo-b/
└── …
```

After running the script:

```text
~/Projects-Backup-2025-08-24/
├── repo-a/
├── repo-b/
└── …
```

## 🚀 Usage

1. Place the script anywhere in your system (e.g., `~/backup-projects.sh`)
2. Make it executable:

```bash
chmod +x ~/backup-projects.sh
```

3. Run the script:

```bash
~/backup-projects.sh
```

## 💡 Notes

- Only repositories with a .git directory at the top level are included.
- Remote default branch is determined dynamically. If that fails, the script attempts fallback detection (main, master, release).
- The .git directories are excluded from the backup to avoid bloated size and keep it clean.
- Re-running on the same day will overwrite the previous day’s backup. For versioned backups, consider appending timestamps down to seconds or storing backups under a dated root directory (not just per day).

## 📂 Related

To ensure you include any dotfiles submodules in your repositories, make sure those are initialized and pulled beforehand:

```bash
git submodule update --init --recursive
```
