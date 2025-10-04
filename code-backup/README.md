# GitHub Projects Backup Script

This script automatically backs up all of your GitHub repositories (both public and private) by:

- Fetching all repositories from your GitHub account using the GitHub API
- Creating a `~/Projects` directory if it doesn't exist
- Cloning new repositories or updating existing ones to their latest default branch
- Creating a timestamped zip backup of all projects: `~/Projects-Backup_YYYY-MM-DD_HH-MM-SS.zip`

---

## 🛠 Requirements

- Bash shell (version 4.0+)
- `git` CLI
- `curl` (for GitHub API calls)
- `jq` (for JSON parsing)
- `zip` (for creating backup archives)
- GitHub account with API access

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

## 🔐 GitHub Authentication

The script will attempt to automatically detect your GitHub username from:

1. Git global configuration (`git config --global user.name`)
2. GitHub API (if authenticated)
3. Manual input prompt

For private repositories, you'll need to authenticate with GitHub. You can either:

- Use a Personal Access Token (recommended)
- Set up SSH keys for Git operations

### Using a Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with `repo` scope for full repository access
3. Set the token as an environment variable:

   ```bash
   export GITHUB_TOKEN="your_token_here"
   ```

---

## 📦 Directory Structure

**Before running:**

```text
~/Projects/ (created if doesn't exist)
```

**After running:**

```text
~/Projects/
├── repo-a/
├── repo-b/
├── private-repo/
└── …

~/Projects-Backup_2025-01-15_14-30-25.zip
```

---

## 🚀 Usage

1. Make the script executable:

```bash
chmod +x code-backup.sh
```

2. Run the script:

```bash
./code-backup.sh
```

3. The script will:

   - Check all dependencies
   - Create necessary directories
   - Fetch your GitHub username
   - Download/update all repositories
   - Create a timestamped backup zip file

---

## 📊 Features

### ✅ What it does:

- **Automatic Discovery**: Uses GitHub API to find all your repositories
- **Smart Updates**: Clones new repos, updates existing ones
- **Default Branch Detection**: Automatically detects and checks out the correct default branch
- **Comprehensive Logging**: Detailed logs with timestamps and error tracking
- **Error Handling**: Robust error handling with detailed error reporting
- **Progress Tracking**: Shows progress and summary statistics
- **Clean Backups**: Excludes `.git` directories and system files from backups

### 🔧 Advanced Features:

- **Pagination Support**: Handles users with many repositories
- **Branch Management**: Automatically switches to default branch before updating
- **Log Management**: Separate log files for general output and errors
- **Dependency Checking**: Validates all required tools before starting
- **Cleanup**: Automatic cleanup of temporary files

---

## 📝 Logging

The script creates detailed logs in the `logs/` directory:

- `code-backup-YYYYMMDD-HHMMSS.log` - General execution log
- `errors-YYYYMMDD-HHMMSS.log` - Error-specific log

Logs include:

- Timestamped entries
- Color-coded output levels (INFO, SUCCESS, WARNING, ERROR)
- Detailed error messages
- Progress tracking
- Summary statistics

---

## ⚙️ Configuration

You can customize the script by modifying these variables at the top:

```bash
readonly PROJECTS_DIR="$HOME/Projects"  # Where to store repositories
readonly LOG_DIR="$SCRIPT_DIR/logs"     # Where to store logs
```

---

## 🚨 Troubleshooting

### Common Issues:

1. **"Missing required dependencies"**
   - Install missing tools using the commands above

2. **"Failed to fetch repositories from GitHub API"**
   - Check your internet connection
   - Verify GitHub API access
   - Consider using a Personal Access Token

3. **"Could not determine default branch"**
   - Repository might be empty or have no branches
   - Check repository permissions

4. **"Failed to clone/update repository"**
   - Check repository permissions
   - Verify SSH keys or authentication
   - Check error log for specific details

### Getting Help:

Check the error log file for detailed error messages:

```bash
cat logs/errors-*.log
```

---

## 🔄 Automation

To run this script automatically, you can set up a cron job:

```bash
# Edit crontab
crontab -e

# Add entry to run daily at 2 AM
0 2 * * * /path/to/code-backup.sh
```

---

## 📂 Related

For repositories with submodules, ensure they're properly initialized:

```bash
git submodule update --init --recursive
```
