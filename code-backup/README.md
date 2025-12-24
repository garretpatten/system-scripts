# GitHub Projects Backup Scripts

This directory contains two scripts for backing up your GitHub repositories:

1. **`code-backup-local.sh`** - Creates a local, zipped directory of all your non-archived projects
2. **`code-backup-gitlab.sh`** - Mirrors all non-archived public and private projects to similarly named GitLab projects

---

## 🛠 Requirements

Both scripts require:

- Bash shell (version 4.0+)
- `git` CLI
- `curl` (for GitHub/GitLab API calls)
- `jq` (for JSON parsing)

The local backup script also requires:
- `zip` (for creating backup archives)

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

## 📦 Script 1: Local Backup (`code-backup-local.sh`)

Creates a local, zipped directory of all your non-archived GitHub repositories.

### Features

- Fetches all non-archived repositories from your GitHub account
- Creates a `~/Projects` directory (or custom via `PROJECTS_DIR` env var)
- Clones new repositories or updates existing ones to their latest default branch
- Creates a timestamped zip backup: `~/Projects-Backup_YYYY-MM-DD_HH-MM-SS.zip`
- Excludes `.git` directories and system files from the zip archive

### 🔐 Authentication

The script supports both public and private repositories:

**For private repositories**, set a GitHub Personal Access Token:

```bash
export GITHUB_TOKEN="your_token_here"
```

To create a token:
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with `repo` scope for full repository access

**Optional environment variables:**

```bash
export GITHUB_USERNAME="your-username"  # Auto-detected if token provided
export PROJECTS_DIR="$HOME/MyProjects"  # Default: ~/Projects
export USE_GITHUB_SSH="true"            # Use SSH instead of HTTPS (default: false)
```

### Usage

```bash
chmod +x code-backup-local.sh
./code-backup-local.sh
```

### Output

- **Local repositories**: `~/Projects/` (or `$PROJECTS_DIR`)
- **Backup archive**: `~/Projects-Backup_YYYY-MM-DD_HH-MM-SS.zip`
- **Logs**: `logs/code-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/errors-YYYYMMDD-HHMMSS.log`

---

## 📦 Script 2: GitLab Mirror (`code-backup-gitlab.sh`)

Mirrors all non-archived public and private GitHub repositories to similarly named GitLab projects.

### Features

- Lists all non-archived GitHub repos you can access
- Creates/updates a local mirror clone (bare repo) for each
- Ensures a same-named GitLab project exists under your namespace
- Pushes a full mirror to GitLab (all branches, tags, and refs)
- Automatically creates GitLab projects if they don't exist (optional)

### 🔐 Authentication

**Required environment variables:**

```bash
export GITLAB_TOKEN="your_gitlab_pat"           # GitLab.com Personal Access Token
export GITLAB_NAMESPACE="your-username"         # Your GitLab username or group
```

**Optional environment variables:**

```bash
export GITHUB_TOKEN="your_github_token"         # For private GitHub repos
export GITHUB_USERNAME="your-username"          # Auto-detected if token provided
export USE_GITHUB_SSH="true"                    # Use SSH for GitHub (default: false)
export AUTO_CREATE_GITLAB_PROJECTS="true"       # Auto-create missing projects (default: true)
export GITLAB_VISIBILITY="private"              # Visibility for new projects: private/internal/public (default: private)
export GITLAB_HOST="https://gitlab.com"         # GitLab instance URL (default: gitlab.com)
export BACKUP_ROOT="$HOME/GitHub-GitLab-Backup" # Where to store local mirrors
```

### Creating GitLab Token

1. Go to GitLab.com → Settings → Access Tokens
2. Create a token with `api` scope (and `write_repository` if needed)
3. Set it as `GITLAB_TOKEN` environment variable

### Usage

```bash
chmod +x code-backup-gitlab.sh

# Set required environment variables
export GITLAB_TOKEN="your_token"
export GITLAB_NAMESPACE="your-username"

# Optional: for private GitHub repos
export GITHUB_TOKEN="your_github_token"

./code-backup-gitlab.sh
```

### How It Works

1. Fetches all non-archived repositories from GitHub
2. For each repository:
   - Creates/updates a local bare mirror clone
   - Checks if a GitLab project exists (creates it if `AUTO_CREATE_GITLAB_PROJECTS=true`)
   - Pushes all branches, tags, and refs to GitLab as a mirror
3. Assumes GitHub and GitLab usernames are the same, and projects have the same name

### Output

- **Local mirrors**: `$BACKUP_ROOT/mirrors-YYYYMMDD-HHMMSS/` (bare repos)
- **Logs**: `logs/gh-gl-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/gh-gl-errors-YYYYMMDD-HHMMSS.log`

---

## 📝 Logging

Both scripts create detailed logs in the `logs/` directory:

**Local Backup:**
- `code-backup-YYYYMMDD-HHMMSS.log` - General execution log
- `errors-YYYYMMDD-HHMMSS.log` - Error-specific log

**GitLab Mirror:**
- `gh-gl-backup-YYYYMMDD-HHMMSS.log` - General execution log
- `gh-gl-errors-YYYYMMDD-HHMMSS.log` - Error-specific log

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

### Getting Help

Check the error log files for detailed error messages:

```bash
# Local backup errors
cat logs/errors-*.log

# GitLab mirror errors
cat logs/gh-gl-errors-*.log
```

---

## 🔄 Automation

To run these scripts automatically, you can set up cron jobs:

```bash
# Edit crontab
crontab -e

# Run local backup daily at 2 AM
0 2 * * * /path/to/code-backup-local.sh

# Run GitLab mirror weekly on Sundays at 3 AM
0 3 * * 0 /path/to/code-backup-gitlab.sh
```

**Note:** When using cron, make sure to set environment variables in your crontab or in a script that sources them:

```bash
# In crontab
0 2 * * * source ~/.bashrc && /path/to/code-backup-gitlab.sh
```

---

## 📂 Notes

### Repository Filtering

Both scripts only process **non-archived** repositories. Archived repositories are automatically excluded.

### Private Repositories

- **Local backup**: Requires `GITHUB_TOKEN` to access private repos
- **GitLab mirror**: Requires both `GITHUB_TOKEN` (for GitHub) and `GITLAB_TOKEN` (for GitLab)

### SSH vs HTTPS

Both scripts support both SSH and HTTPS for GitHub operations:
- Set `USE_GITHUB_SSH="true"` to use SSH (requires SSH keys configured)
- Default is HTTPS with token authentication

### GitLab Project Creation

The GitLab mirror script can automatically create GitLab projects if they don't exist:
- Set `AUTO_CREATE_GITLAB_PROJECTS="true"` (default)
- New projects will be created with visibility set by `GITLAB_VISIBILITY` (default: `private`)

### Submodules

For repositories with submodules, ensure they're properly initialized:

```bash
git submodule update --init --recursive
```

---

## 🔗 Related

- [GitHub API Documentation](https://docs.github.com/en/rest)
- [GitLab API Documentation](https://docs.gitlab.com/ee/api/)
- [Git Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitLab Personal Access Tokens](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html)
