# Backups

This module contains scripts for backing up code repositories and Todoist tasks.

- **`code/`** — GitHub repository backups
  - `code-backup-local.sh` — Creates a local, zipped directory of all your
    non-archived projects
  - `code-backup-gitlab.sh` — Mirrors all non-archived public and private
    projects to similarly named GitLab projects
- **`todoist/`** — Todoist task backups
  - `todoist-backup.sh` — Retrieves tasks, projects, and labels via the Todoist
    REST API and creates a zip archive
- **`run-all.sh`** — Runs `code-local`, `code-gitlab`, and `todoist` backups in
  one command

---

## 🛠 Requirements

All scripts require Bash shell (version 4.0+) and `curl`.

**Code backups also require:**

- `git`
- `jq`
- `zip` (local backup only)

**Todoist backup also requires:**

- `jq`
- `zip`

### Installing Dependencies

**macOS (using Homebrew):**

```bash
brew install git curl jq zip
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install git curl jq zip
```

**CentOS/RHEL:**

```bash
sudo yum install git curl jq zip
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

---

## 📦 Local Code Backup (`code/code-backup-local.sh`)

Creates a local, zipped directory of all your non-archived GitHub repositories.

### Local Backup Features

- Fetches all non-archived repositories from your GitHub account
- Clones new repositories or updates existing ones to their latest default branch
- Creates a zip backup: `~/Code-Backup_MM-DD-YY.zip`
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

- **Local repositories**: `~/Code-Backup_MM-DD-YY/`
- **Backup archive**: `~/Code-Backup_MM-DD-YY.zip`
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
- Creates a zip backup: `~/Todoist-Backup_MM-DD-YY.zip`

### Todoist Backup Usage

```bash
./backups/todoist/todoist-backup.sh
```

Or via npm:

```bash
npm run backup:todoist
```

### Todoist Backup Output

- **Backup archive**: `~/Todoist-Backup_MM-DD-YY.zip`
- **Logs**: `backups/logs/todoist-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `backups/logs/todoist-errors-YYYYMMDD-HHMMSS.log`

The zip contains:

- `tasks.json`
- `projects.json`
- `labels.json`

---

## 🚀 Run All Backups

To run the code-local, code-gitlab, and todoist backups in sequence:

```bash
./backups/run-all.sh
```

Or via npm:

```bash
npm run backup:all
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

### Getting Help

Check the error log files for detailed error messages:

```bash
cat backups/logs/errors-*.log
cat backups/logs/gh-gl-errors-*.log
cat backups/logs/todoist-errors-*.log
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
- [Git Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitLab Personal Access Tokens](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html)
