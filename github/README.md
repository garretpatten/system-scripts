# GitHub Security Report

Generates a dated report of open Dependabot and code scanning ("Security and
quality") alerts for every repository owned by your GitHub profile. The
implementation is TypeScript and unit-testable with mocked dependencies.

- **`src/`** — TypeScript source code
  - `types.ts` — Report domain types and context contracts
  - `alerts.ts` — GitHub API client (owned repositories, Dependabot alerts,
    code scanning alerts)
  - `report.ts` — Pure Markdown report builder
  - `security-report.ts` — Orchestrator and CLI entry point
- **`__tests__/unit/`** — Jest unit tests with mocked HTTP and file-system
  clients

## What It Does

- Reads a GitHub Personal Access Token from `.env` (`.env.example` documents it)
- Lists all repositories owned by the authenticated account (public and
  private), including archived ones
- Fetches every **open Dependabot alert** and **open code scanning alert** per
  repository, handling pagination for large repositories
- Writes a dated Markdown report summarising alerts by severity and project:
  `~/GitHub-Security-Report_YYYY-MM-DD.md` by default (one file per day is
  overwritten in place)
- Repositories where alert data is unavailable (e.g. Dependabot disabled on the
  repository, or code scanning never produced an analysis) are listed under the
  project's **Warnings** section instead of being silently skipped

## Requirements

- Node.js 20+
- A GitHub Personal Access Token with read access to security alerts:
  - **Classic PAT**: `security_events` scope (or `repo`)
  - **Fine-grained PAT**: `Dependabot alerts` and `Code scanning alerts`
    read-only permissions
- Re-run `npm install` if dependencies are not present already

## Environment Variables

Copy `.env.example` to `.env` in the project root and fill in your tokens:

```bash
cp .env.example .env
```

- `GITHUB_SECURITY_TOKEN` — PAT used by this tool; falls back to `GITHUB_TOKEN`
  when empty (one of the two must be set)
- `GITHUB_SECURITY_USERNAME` — profile label shown in the report header
  (default: `garretpatten`)
- `GITHUB_SECURITY_REPORT_DIR` — directory for the generated report
  (default: `$HOME`)

Repositories are always read from the account that owns the token
(`/user/repos?type=owner`), so the token's owner defines the scope; the
username variable only labels the report.

## Usage

```bash
npm run github:security-report
```

## Output

- **Report**: `~/GitHub-Security-Report_YYYY-MM-DD.md`
- **Logs**: `github/logs/github-security-report-YYYYMMDD-HHMMSS.log`

Report structure:

```text
# GitHub Security and Quality Report
## Summary                 (severity table: Dependabot vs code scanning)
## Alerts by repository    (one section per project with alerts or warnings)
## Repositories with no open alerts
```

Each project section lists open Dependabot alerts (package, advisory summary,
CVE/GHSA, manifest and patched version) and open code scanning alerts (rule,
tool, location) with links to the alerts on GitHub.

## Running Tests

```bash
npm test
npm run typecheck
```

## Automation

```bash
# Weekly audit, Mondays at 8 AM
0 8 * * 1 cd /path/to/system-scripts && npm run github:security-report
```

## Troubleshooting

1. **"GitHub token is required"**
   - Set `GITHUB_SECURITY_TOKEN` (or `GITHUB_TOKEN`) in `.env`
2. **"Dependabot alerts unavailable (HTTP 403): Dependabot alerts are disabled"**
   - The repository has Dependabot alerts turned off in its security settings
3. **"Code scanning alerts unavailable (HTTP 403)"**
   - Code scanning is not enabled (private repositories require GitHub Advanced
     Security) or the token lacks the alerts permission
4. **"Code scanning alerts unavailable (HTTP 404): no analysis found"**
   - Code scanning is enabled but the repository has never been analysed
5. **"Bad credentials"**
   - The token is expired or revoked; regenerate it in GitHub settings

## Related

- [Backups Documentation](../backups/README.md) — shares the same `.env` file
- [GitHub Dependabot Alerts API](https://docs.github.com/en/rest/dependabot/alerts)
- [GitHub Code Scanning API](https://docs.github.com/en/rest/code-scanning/code-scanning)
