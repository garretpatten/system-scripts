# Backups

This module contains scripts for backing up code repositories, Todoist tasks,
Notion workspaces, browser bookmarks, and Standard Notes. The implementation has
been ported to TypeScript so the backup logic is unit-testable with mocked
dependencies.

- **`src/`** — TypeScript source code
  - `local-backup.ts` — Local GitHub repository backup
  - `gitlab-mirror.ts` — GitHub to GitLab mirror
  - `todoist-backup.ts` — Todoist backup
  - `notion-backup.ts` — Notion Markdown export
  - `brave-bookmarks-backup.ts` — Brave bookmarks HTML/JSON export
  - `chrome-bookmarks-backup.ts` — Chrome bookmarks HTML/JSON export
  - `standard-notes-backup.ts` — Standard Notes plaintext backup export
  - `google-calendar-backup.ts` — Google Calendar export
  - `google-tasks-backup.ts` — Google Tasks export
  - `run-all.ts` — Orchestrator that runs all backups
  - `github.ts`, `gitlab.ts`, `todoist.ts`, `notion.ts` — API clients
  - `google-calendar.ts`, `google-tasks.ts` — Google API clients
  - `google-auth.ts` — Shared Google OAuth 2.0 token refresh
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
- **`chrome-bookmarks/`** — Backward-compatible shell wrapper
  - `chrome-bookmarks-backup.sh` — Thin wrapper around `chrome-bookmarks-backup.ts`
- **`standard-notes/`** — Backward-compatible shell wrapper
  - `standard-notes-backup.sh` — Thin wrapper around `standard-notes-backup.ts`
- **`google-calendar/`** — Backward-compatible shell wrapper
  - `google-calendar-backup.sh` — Thin wrapper around
    `google-calendar-backup.ts`
- **`google-tasks/`** — Backward-compatible shell wrapper
  - `google-tasks-backup.sh` — Thin wrapper around `google-tasks-backup.ts`
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

**Todoist, Notion, Standard Notes, and Google backups also require:**

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

### Google Calendar and Google Tasks backups

Both Google backups share the same OAuth 2.0 credentials:

```bash
# Required
GOOGLE_CLIENT_ID="your_google_oauth_client_id"
GOOGLE_CLIENT_SECRET="your_google_oauth_client_secret"

# Optional: filled in automatically on first run (see below)
GOOGLE_REFRESH_TOKEN=""

# Optional
GOOGLE_CALENDAR_SHOW_DELETED="false"
GOOGLE_TASKS_SHOW_COMPLETED="true"
GOOGLE_TASKS_SHOW_DELETED="true"
GOOGLE_TASKS_SHOW_HIDDEN="true"
```

Create an OAuth 2.0 **Desktop app** client in the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) and
enable the **Google Calendar API** and **Google Tasks API** for the project.

You do not need to create a refresh token yourself. The first time you run
either Google backup individually (`npm run backup:google-calendar` or
`npm run backup:google-tasks`), the script starts a local listener, prints a
Google consent URL to open in your browser, and exchanges the authorization
for a refresh token that is saved to `.env`. The consent requests these
read-only scopes:

- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/tasks.readonly`

Subsequent runs — including `npm run backup:all` and cron jobs — reuse the
saved token and run unattended.

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

## 🔵 Chrome Bookmarks Export (`chrome-bookmarks/chrome-bookmarks-backup.sh`)

Converts the Google Chrome bookmarks file to Netscape Bookmark File Format HTML
and optionally keeps a dated JSON copy of the original profile data.

### Chrome Bookmarks Export Features

- Detects the Chrome bookmarks file on Linux or macOS
- Warns if Chrome appears to be running (the file may be locked or stale)
- Converts the Chromium bookmarks JSON to valid Netscape HTML
- Preserves folder hierarchy and basic metadata (name, URL, dates)
- Leaves the original Chrome profile data untouched
- Creates a dated JSON copy of the original file alongside the HTML export

### Chrome Bookmarks Export Usage

```bash
./backups/chrome-bookmarks/chrome-bookmarks-backup.sh
```

Or via npm:

```bash
npm run backup:chrome-bookmarks
```

### Chrome Bookmarks Export Output

- **HTML export**: `~/chrome-bookmarks_YYYY-MM-DD.html`
- **JSON copy**: `~/chrome-bookmarks_YYYY-MM-DD.json`
- **Logs**: `backups/logs/chrome-bookmarks-backup-YYYYMMDD-HHMMSS.log`

---

## 📝 Standard Notes Export (`standard-notes/standard-notes-backup.sh`)

Backs up Standard Notes when **Plaintext Backups** is enabled and set to save in
the home directory.

### Standard Notes Export Features

- Discards the Standard Notes identifier suffix from each filename (`-id_txt`)
- Renotes files to lowercase kebab-case Markdown names (`name-of-note.md`)
- Preserves nested folder structure from the Plaintext Backups directory
- Creates a zip backup: `~/Standard-Notes_YYYY-MM-DD.zip`
- Exits gracefully with a helpful message when Plaintext Backups is not enabled

### Standard Notes Export Requirements

Plaintext Backups must be enabled in Standard Notes and the destination must be:

```text
$HOME/garret.patten@proton.me/Plaintext Backups/
```

If that directory is not found, the script logs a warning and exits without
creating an archive.

### Standard Notes Export Usage

```bash
./backups/standard-notes/standard-notes-backup.sh
```

Or via npm:

```bash
npm run backup:standard-notes
```

### Standard Notes Export Output

- **Backup archive**: `~/Standard-Notes_YYYY-MM-DD.zip`
- **Logs**: `backups/logs/standard-notes-backup-YYYYMMDD-HHMMSS.log`

---

## 📅 Google Calendar Export (`google-calendar/google-calendar-backup.sh`)

Exports all calendars visible to the authenticated user — including secondary
and shared calendars with at least reader access — together with their events.

### Google Calendar Export Features

- Guides you through a one-time Google authorization on first run and saves
  the refresh token to `.env`
- Discovers all calendars via the Calendar API (handles pagination)
- Exports every event per calendar, expanding recurring events into instances
- Optionally includes deleted/cancelled events
  (`GOOGLE_CALENDAR_SHOW_DELETED="true"`)
- Writes pretty-printed JSON files to a temporary directory
- Creates a zip backup: `~/Google-Calendar-Export_YYYY-MM-DD.zip`

### Google Calendar Export Usage

```bash
./backups/google-calendar/google-calendar-backup.sh
```

Or via npm:

```bash
npm run backup:google-calendar
```

### Google Calendar Export Output

- **Backup archive**: `~/Google-Calendar-Export_YYYY-MM-DD.zip`
- **Logs**: `backups/logs/google-calendar-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `backups/logs/google-calendar-errors-YYYYMMDD-HHMMSS.log`

The zip contains a `calendars.json` index plus one directory per calendar with
`calendar.json` (metadata) and `events.json` (all events).

---

## ✅ Google Tasks Export (`google-tasks/google-tasks-backup.sh`)

Exports all task lists and tasks belonging to the authenticated user.

### Google Tasks Export Features

- Guides you through a one-time Google authorization on first run and saves
  the refresh token to `.env`
- Discovers all task lists via the Tasks API (handles pagination)
- Exports every task per list, including completed, deleted, and hidden tasks
  (configurable via `GOOGLE_TASKS_SHOW_COMPLETED`, `GOOGLE_TASKS_SHOW_DELETED`,
  and `GOOGLE_TASKS_SHOW_HIDDEN`)
- Writes pretty-printed JSON files to a temporary directory
- Creates a zip backup: `~/Google-Tasks-Export_YYYY-MM-DD.zip`

### Google Tasks Export Usage

```bash
./backups/google-tasks/google-tasks-backup.sh
```

Or via npm:

```bash
npm run backup:google-tasks
```

### Google Tasks Export Output

- **Backup archive**: `~/Google-Tasks-Export_YYYY-MM-DD.zip`
- **Logs**: `backups/logs/google-tasks-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `backups/logs/google-tasks-errors-YYYYMMDD-HHMMSS.log`

The zip contains a `task-lists.json` index plus one directory per task list
with `task-list.json` (metadata) and `tasks.json` (all tasks).

---

## 🚀 Run All Backups

To run the code-local, code-gitlab, todoist, notion, brave-bookmarks,
chrome-bookmarks, standard-notes, google-calendar, and google-tasks backups in
sequence:

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

**Chrome Bookmarks Export:**

- `chrome-bookmarks-backup-YYYYMMDD-HHMMSS.log`

**Standard Notes Export:**

- `standard-notes-backup-YYYYMMDD-HHMMSS.log`

**Google Calendar Export:**

- `google-calendar-backup-YYYYMMDD-HHMMSS.log`
- `google-calendar-errors-YYYYMMDD-HHMMSS.log`

**Google Tasks Export:**

- `google-tasks-backup-YYYYMMDD-HHMMSS.log`
- `google-tasks-errors-YYYYMMDD-HHMMSS.log`

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

15. **Chrome Bookmarks: "Chrome bookmarks file not found"**
    - Ensure Chrome has been launched at least once so the profile directory exists
    - Check that the bookmarks file exists at
      `~/.config/google-chrome/Default/Bookmarks` (Linux) or
      `~/Library/Application Support/Google/Chrome/Default/Bookmarks` (macOS)

16. **Chrome Bookmarks: "Chrome appears to be running"**
    - This is a warning, not a fatal error
    - Close Chrome and re-run the backup to ensure the bookmarks file is not locked

17. **Chrome Bookmarks: "Failed to parse Chrome bookmarks JSON"**
    - The Chrome profile may be corrupted or the file may be partially written
    - Close Chrome and try again
    - Review `backups/logs/chrome-bookmarks-backup-*.log` for details

18. **Standard Notes: "Plaintext Backups must be enabled"**
    - Enable **Plaintext Backups** in Standard Notes settings
    - Set the backup location to your home directory
    - Verify the directory exists at
      `$HOME/garret.patten@proton.me/Plaintext Backups/`

19. **Google: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"**
    - Add your Google OAuth 2.0 Desktop app credentials to `.env`

20. **Google: "Missing GOOGLE_REFRESH_TOKEN"**
    - Run `npm run backup:google-calendar` or `npm run backup:google-tasks`
      once in an interactive terminal to complete the browser authorization;
      the token is saved to `.env` automatically
    - `npm run backup:all` cannot perform the interactive authorization, so
      it needs the token from a prior individual run

21. **Google: "Google OAuth token refresh failed"**
    - The saved refresh token may have been revoked or the OAuth client
      regenerated; remove `GOOGLE_REFRESH_TOKEN` from `.env` and run an
      individual Google backup once to re-authorize
    - Ensure the authorization was granted the `calendar.readonly` and
      `tasks.readonly` scopes
    - Review `backups/logs/google-calendar-errors-*.log` or
      `backups/logs/google-tasks-errors-*.log` for details

22. **Google: "Timed out waiting for Google authorization"**
    - Re-run the backup and complete the consent in your browser within five
      minutes
    - Make sure the browser can reach the printed `http://127.0.0.1` redirect
      address (run the first authorization on a machine with a browser)

### Getting Help

Check the error log files for detailed error messages:

```bash
cat backups/logs/errors-*.log
cat backups/logs/gh-gl-errors-*.log
cat backups/logs/todoist-errors-*.log
cat backups/logs/notion-errors-*.log
cat backups/logs/standard-notes-backup-*.log
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
0 7 * * * cd /path/to/system-scripts && npm run backup:chrome-bookmarks
0 8 * * * cd /path/to/system-scripts && npm run backup:standard-notes
0 9 * * * cd /path/to/system-scripts && npm run backup:google-calendar
0 10 * * * cd /path/to/system-scripts && npm run backup:google-tasks
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
- [Google Calendar API Documentation](https://developers.google.com/calendar/api/v3/reference)
- [Google Tasks API Documentation](https://developers.google.com/tasks/reference/rest)
- [Git Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitLab Personal Access Tokens](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html)
