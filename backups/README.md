# Backups

This module contains scripts for backing up code repositories, Todoist tasks,
and Notion workspaces. The implementation has been ported to TypeScript so the
backup logic is unit-testable with mocked dependencies.

- **`src/`** — TypeScript source code
  - `local-backup.ts` — Local GitHub repository backup
  - `gitlab-mirror.ts` — GitHub to GitLab mirror
  - `todoist-backup.ts` — Todoist backup
  - `notion-backup.ts` — Notion Markdown export
  - `brave-bookmarks-backup.ts` — Brave bookmarks HTML/JSON export
  - `run-all.ts` — Orchestrator that runs all backups
  - `github.ts`, `gitlab.ts`, `todoist.ts`, `notion.ts` — API clients
  - `logger.ts`, `env.ts`, `fs.ts`, `http.ts`, `git.ts`, `archive.ts` — shared
    abstractions
- **`__tests__/unit/`** — Jest unit tests with mocked I/O
- **`code/`** — Backward-compatible shell wrappers
  - `code-backup-local.sh` — Thin wrapper around `local-backup.ts`
  - `code-backup-gitlab.sh` — Thin wrapper around `gitlab-mirror.ts`
- **`todoist/`** — Backward-compatible shell wrapper
  - `todoist-backup.sh` — Thin wrapper around `todoist-backup.ts`
- **`notion/`** — Backward-compatible shell wrapper
  - `notion-backup.sh` — Thin wrapper around `notion-backup.ts`
- **`brave-bookmarks/`** — Backward-compatible shell wrapper
  - `brave-bookmarks-backup.sh` — Thin wrapper around `brave-bookmarks-backup.ts`
- **`run-all.sh`** — Thin wrapper around `run-all.ts`

## Running Tests

The test suite uses Jest with mocked HTTP, file-system, git, and archive
clients so no real API calls or git operations are performed.

```bash
npm test
```

Run the TypeScript compiler in check-only mode:

```bash
npm run typecheck
```

---

## 🛠 Requirements

The backups module is implemented in TypeScript and runs on Node.js. The original
shell entry points are now thin wrappers around the TypeScript implementation.

- Node.js 20+
- `npm` (or `pnpm`/`yarn`)
- Bash shell (version 4.0+) for the wrapper scripts

**Code backups also require:**

- `git`
- `zip` (local backup only)

**Todoist and Notion backups also require:**

- `zip`

### Installing Dependencies

**Node.js dependencies:**

```bash
npm install
```

**System dependencies (macOS using Homebrew):**

```bash
brew install git curl zip
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install git curl zip
```

**CentOS/RHEL:**

```bash
sudo yum install git curl zip
```

---

## 🔐 Environment Variables

Copy `.env.example` to `.env` in the project root and fill in your tokens:

```bash
cp .env.example .env
```

All backup scripts automatically load `.env` from the project root when present.
You can also export variables in your shell instead.

### Code backups

```bash
# Optional: access private GitHub repos
GITHUB_TOKEN="your_github_token"

# Optional: auto-detected if GITHUB_TOKEN is provided
GITHUB_USERNAME="your-username"

# Optional: use SSH for GitHub clones (default: false)
USE_GITHUB_SSH="false"
```

### GitLab mirror

```bash
# Required
GITLAB_TOKEN="your_gitlab_pat"
GITLAB_NAMESPACE="your-username"

# Optional
AUTO_CREATE_GITLAB_PROJECTS="true"
GITLAB_VISIBILITY="private"
GITLAB_HOST="https://gitlab.com"
BACKUP_ROOT="$HOME/GitHub-GitLab-Backup"
```

### Todoist backup

```bash
# Required
TODOIST_API_TOKEN="your_todoist_api_token"
```

To create a Todoist token, visit **Todoist Settings → Integrations → Developer →
API token**.

### Notion backup

```bash
# Required
NOTION_API_TOKEN="your_notion_integration_token"
```

To create a Notion integration token, visit
**Notion Settings & members → Integrations → Develop your own → New integration**.
After creating the integration, you must share each page or database you want to
export with the integration from its **Share** menu. The Notion API can only
access content explicitly shared with the integration.

---

## 📦 Local Code Backup (`code/code-backup-local.sh`)

Creates a local, zipped directory of all your non-archived GitHub repositories.

### Local Backup Features

- Fetches all non-archived repositories from your GitHub account
- Clones new repositories or updates existing ones to their latest default branch
- Creates a zip backup: `~/Code-Export_YYYY-MM-DD.zip`
- Excludes `.git` directories and system files from the zip archive

### Local Backup Usage

```bash
./backups/code/code-backup-local.sh
```

Or via npm:

```bash
npm run backup:code-local
```

### Local Backup Output

- **Local repositories**: `~/Code-Export_YYYY-MM-DD/`
- **Backup archive**: `~/Code-Export_YYYY-MM-DD.zip`
- **Logs**: `backups/logs/code-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `backups/logs/errors-YYYYMMDD-HHMMSS.log`

---

## 🦊 GitLab Code Mirror (`code/code-backup-gitlab.sh`)

Mirrors all non-archived GitHub repositories to GitLab.

### GitLab Mirror Features

- Lists all non-archived GitHub repos you can access
- Creates/updates a local mirror clone (bare repo) for each
- Ensures a same-named GitLab project exists under your namespace
- Pushes a full mirror to GitLab (all branches, tags, and refs)

### GitLab Mirror Usage

```bash
./backups/code/code-backup-gitlab.sh
```

Or via npm:

```bash
npm run backup:code-gitlab
```

### How It Works

1. Fetches all non-archived repositories from GitHub
2. For each repository:
   - Creates/updates a local bare mirror clone
   - Checks if a GitLab project exists (creates it if
     `AUTO_CREATE_GITLAB_PROJECTS=true`)
   - Pushes all branches, tags, and refs to GitLab as a mirror

### Output

- **Local mirrors**: `$BACKUP_ROOT/mirrors-YYYYMMDD-HHMMSS/` (bare repos)
- **Logs**: `backups/logs/gh-gl-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `backups/logs/gh-gl-errors-YYYYMMDD-HHMMSS.log`

---

## ✅ Todoist Backup (`todoist/todoist-backup.sh`)

Backs up active Todoist tasks, projects, and labels.

### Todoist Backup Features

- Retrieves all active tasks via the Todoist REST API
- Fetches projects and labels for context
- Writes pretty-printed JSON files to a temporary directory
- Creates a zip backup: `~/Todoist-Export_YYYY-MM-DD.zip`

### Todoist Backup Usage

```bash
./backups/todoist/todoist-backup.sh
```

Or via npm:

```bash
npm run backup:todoist
```

### Todoist Backup Output

- **Backup archive**: `~/Todoist-Export_YYYY-MM-DD.zip`
- **Logs**: `backups/logs/todoist-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `backups/logs/todoist-errors-YYYYMMDD-HHMMSS.log`

The zip contains:

- `tasks.json`
- `projects.json`
- `labels.json`

---

## Notion Workspace Export (`notion/notion-backup.sh`)

Exports all pages and databases the integration can access as Markdown files in
nested folders that mirror the workspace structure.

### Notion Export Features

- Discovers pages and databases shared with the integration
- Builds a nested folder structure based on parent/child relationships
- Exports each page as a Markdown file with headings, lists, checkboxes, code
  blocks, quotes, and other basic blocks
- Exports each database as a Markdown file listing its entries and properties
- Ignores toggle block wrappers (their children are exported inline)
- Creates a zip backup: `~/Notion-Export_YYYY-MM-DD.zip`

### Notion Export Limitations

- The integration must be added to every page or database you want to export.
  Private content that is not shared with the integration will not be included.
- Advanced or proprietary Notion block types are rendered as comments or simple
  placeholders.
- Export speed is intentionally throttled to respect Notion API rate limits.

### Notion Export Usage

```bash
./backups/notion/notion-backup.sh
```

Or via npm:

```bash
npm run backup:notion
```

### Notion Export Output

- **Backup archive**: `~/Notion-Export_YYYY-MM-DD.zip`
- **Logs**: `backups/logs/notion-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `backups/logs/notion-errors-YYYYMMDD-HHMMSS.log`

---

## 🦁 Brave Bookmarks Export (`brave-bookmarks/brave-bookmarks-backup.sh`)

Converts the Brave Browser bookmarks file to Netscape Bookmark File Format HTML
and optionally keeps a dated JSON copy of the original profile data.

### Brave Bookmarks Export Features

- Detects the Brave bookmarks file on Linux or macOS
- Warns if Brave appears to be running (the file may be locked or stale)
- Converts the Chromium bookmarks JSON to valid Netscape HTML
- Preserves folder hierarchy and basic metadata (name, URL, dates)
- Leaves the original Brave profile data untouched
- Creates a dated JSON copy of the original file alongside the HTML export

### Brave Bookmarks Export Usage

```bash
./backups/brave-bookmarks/brave-bookmarks-backup.sh
```

Or via npm:

```bash
npm run backup:brave-bookmarks
```

### Brave Bookmarks Export Output

- **HTML export**: `~/brave-bookmarks_YYYY-MM-DD.html`
- **JSON copy**: `~/brave-bookmarks_YYYY-MM-DD.json`
- **Logs**: `backups/logs/brave-bookmarks-backup-YYYYMMDD-HHMMSS.log`

---

## 🚀 Run All Backups

To run the code-local, code-gitlab, todoist, notion, and brave-bookmarks backups
in sequence:

```bash
./backups/run-all.sh
```

Or via npm:

```bash
npm run backup:all
npm run backups
```

The orchestrator captures each backup's output in a combined log and reports the
status of each step.

---

## 📝 Logging

All scripts create detailed logs in `backups/logs/`:

**Local Backup:**

- `code-backup-YYYYMMDD-HHMMSS.log`
- `errors-YYYYMMDD-HHMMSS.log`

**GitLab Mirror:**

- `gh-gl-backup-YYYYMMDD-HHMMSS.log`
- `gh-gl-errors-YYYYMMDD-HHMMSS.log`

**Todoist Backup:**

- `todoist-backup-YYYYMMDD-HHMMSS.log`
- `todoist-errors-YYYYMMDD-HHMMSS.log`

**Notion Export:**

- `notion-backup-YYYYMMDD-HHMMSS.log`
- `notion-errors-YYYYMMDD-HHMMSS.log`

**Brave Bookmarks Export:**

- `brave-bookmarks-backup-YYYYMMDD-HHMMSS.log`

**Orchestrator:**

- `backups-YYYYMMDD-HHMMSS.log`

Logs include:

- Timestamped entries
- Color-coded output levels (INFO, SUCCESS, WARNING, ERROR)
- Detailed error messages
- Progress tracking
- Summary statistics

---

## 🚨 Troubleshooting

### Common Issues

1. **"Missing required dependencies"**
   - Install missing tools using the commands above

2. **"Failed to fetch repositories from GitHub API"**
   - Check your internet connection
   - Verify GitHub API access
   - For private repos, ensure `GITHUB_TOKEN` is set correctly

3. **"Could not determine default branch"**
   - Repository might be empty or have no branches
   - Check repository permissions

4. **"Failed to clone/update repository"**
   - Check repository permissions
   - Verify SSH keys or authentication tokens
   - Check error log for specific details

5. **GitLab: "Could not find GitLab namespace"**
   - Verify `GITLAB_NAMESPACE` is set correctly
   - Ensure your GitLab token has proper permissions
   - Check that the namespace exists (username or group)

6. **GitLab: "Failed to push mirror"**
   - Verify `GITLAB_TOKEN` has `write_repository` scope
   - Check that the GitLab project exists or auto-create is enabled
   - Review error log for specific GitLab API errors

7. **Todoist: "Set TODOIST_API_TOKEN"**
   - Add your Todoist API token to `.env`
   - Ensure the token has not been revoked

8. **Todoist: "Todoist API error"**
   - Check your internet connection
   - Verify the token is valid
   - Review `backups/logs/todoist-errors-*.log` for details

9. **Notion: "Set NOTION_API_TOKEN"**
   - Add your Notion integration token to `.env`
   - Ensure the integration has not been deleted or restricted

10. **Notion: "No pages or databases found"**
    - Share the pages and databases you want to export with your integration
    - The Notion API cannot access private content automatically

11. **Notion: "Notion API error"**
    - Check your internet connection
    - Verify the token is valid
    - Confirm the integration has access to the requested content
    - Review `backups/logs/notion-errors-*.log` for details

12. **Brave Bookmarks: "Brave bookmarks file not found"**
    - Ensure Brave has been launched at least once so the profile directory exists
    - Check that the bookmarks file exists at
      `~/.config/BraveSoftware/Brave-Browser/Default/Bookmarks` (Linux) or
      `~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks`
      (macOS)

13. **Brave Bookmarks: "Brave appears to be running"**
    - This is a warning, not a fatal error
    - Close Brave and re-run the backup to ensure the bookmarks file is not locked

14. **Brave Bookmarks: "Failed to parse Brave bookmarks JSON"**
    - The Brave profile may be corrupted or the file may be partially written
    - Close Brave and try again
    - Review `backups/logs/brave-bookmarks-backup-*.log` for details

### Getting Help

Check the error log files for detailed error messages:

```bash
cat backups/logs/errors-*.log
cat backups/logs/gh-gl-errors-*.log
cat backups/logs/todoist-errors-*.log
cat backups/logs/notion-errors-*.log
```

---

## 🔄 Automation

To run these scripts automatically, you can set up cron jobs:

```bash
# Edit crontab
crontab -e

# Run all backups daily at 2 AM
0 2 * * * cd /path/to/system-scripts && npm run backup:all

# Run individual backups
0 2 * * * cd /path/to/system-scripts && npm run backup:code-local
0 3 * * 0 cd /path/to/system-scripts && npm run backup:code-gitlab
0 4 * * * cd /path/to/system-scripts && npm run backup:todoist
0 5 * * * cd /path/to/system-scripts && npm run backup:notion
0 6 * * * cd /path/to/system-scripts && npm run backup:brave-bookmarks
```

**Note:** When using cron, make sure environment variables are available in
`.env` in the project root, or source them before running the script.

---

## 📂 Notes

### Repository Filtering

Code backup scripts only process **non-archived** repositories. Archived
repositories are automatically excluded.

### Private Repositories

- **Local backup**: Requires `GITHUB_TOKEN` to access private repos
- **GitLab mirror**: Requires both `GITHUB_TOKEN` (for GitHub) and
  `GITLAB_TOKEN` (for GitLab)

### SSH vs HTTPS

Code backup scripts support both SSH and HTTPS for GitHub operations:

- Set `USE_GITHUB_SSH="true"` to use SSH (requires SSH keys configured)
- Default is HTTPS with token authentication

### GitLab Project Creation

The GitLab mirror script can automatically create GitLab projects if they don't
exist:

- Set `AUTO_CREATE_GITLAB_PROJECTS="true"` (default)
- New projects will be created with visibility set by `GITLAB_VISIBILITY`
  (default: `private`)

### Submodules

For repositories with submodules, ensure they're properly initialized:

```bash
git submodule update --init --recursive
```

---

## 🔗 Related

- [Git Scripts Documentation](../git-scripts/README.md) — clone and sync repos
  before running a backup
- [GitHub API Documentation](https://docs.github.com/en/rest)
- [GitLab API Documentation](https://docs.gitlab.com/ee/api/)
- [Todoist REST API Documentation](https://developer.todoist.com/rest/v2/)
- [Notion API Documentation](https://developers.notion.com/)
- [Git Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitLab Personal Access Tokens](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html)
