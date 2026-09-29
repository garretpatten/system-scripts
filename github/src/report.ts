import { formatTimestamp } from '../../backups/src/utils.js';
import { AlertSeverity, CodeScanningAlert, DependabotAlert, RepoAlertsReport } from './types.js';

export interface SecurityReportInput {
  generatedAt: Date;
  username: string;
  repos: RepoAlertsReport[];
}

const SEVERITY_ORDER: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'unknown'];
const EMPTY_COUNTS: Record<AlertSeverity, number> = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
};

export interface SeverityTotals {
  dependabot: Record<AlertSeverity, number>;
  codeScanning: Record<AlertSeverity, number>;
  dependabotTotal: number;
  codeScanningTotal: number;
}

export function summarizeAlerts(repos: RepoAlertsReport[]): SeverityTotals {
  const totals: SeverityTotals = {
    dependabot: { ...EMPTY_COUNTS },
    codeScanning: { ...EMPTY_COUNTS },
    dependabotTotal: 0,
    codeScanningTotal: 0,
  };

  for (const repo of repos) {
    for (const alert of repo.dependabot) {
      totals.dependabot[alert.severity] += 1;
      totals.dependabotTotal += 1;
    }
    for (const alert of repo.codeScanning) {
      totals.codeScanning[alert.severity] += 1;
      totals.codeScanningTotal += 1;
    }
  }

  return totals;
}

export function buildSecurityReport(input: SecurityReportInput): string {
  const lines: string[] = [];
  const totals = summarizeAlerts(input.repos);

  lines.push('# GitHub Security and Quality Report');
  lines.push('');
  lines.push(`- **Profile:** ${input.username}`);
  lines.push(`- **Generated:** ${formatTimestamp(input.generatedAt)} UTC`);
  lines.push(`- **Repositories scanned:** ${input.repos.length}`);
  lines.push(`- **Open Dependabot alerts:** ${totals.dependabotTotal}`);
  lines.push(`- **Open code scanning alerts:** ${totals.codeScanningTotal}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');

  if (totals.dependabotTotal === 0 && totals.codeScanningTotal === 0) {
    lines.push('No open alerts were found.');
    lines.push('');
  } else {
    lines.push('| Severity | Dependabot | Code scanning | Total |');
    lines.push('| -------- | ---------- | ------------- | ----- |');
    for (const severity of SEVERITY_ORDER) {
      const total = totals.dependabot[severity] + totals.codeScanning[severity];
      lines.push(
        tableRow([
          severity,
          String(totals.dependabot[severity]),
          String(totals.codeScanning[severity]),
          String(total),
        ]),
      );
    }
    const grandTotal = totals.dependabotTotal + totals.codeScanningTotal;
    lines.push(
      tableRow([
        `**Total**`,
        `**${totals.dependabotTotal}**`,
        `**${totals.codeScanningTotal}**`,
        `**${grandTotal}**`,
      ]),
    );
    lines.push('');
  }

  const sections = [...input.repos]
    .filter(
      (repo) =>
        repo.dependabot.length > 0 || repo.codeScanning.length > 0 || repo.warnings.length > 0,
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  if (sections.length > 0) {
    lines.push('## Alerts by repository');
    lines.push('');
  }

  for (const repo of sections) {
    lines.push(...buildRepoSection(repo));
  }

  const cleanRepos = [...input.repos]
    .filter(
      (repo) =>
        repo.dependabot.length === 0 &&
        repo.codeScanning.length === 0 &&
        repo.warnings.length === 0,
    )
    .map((repo) => repo.fullName)
    .sort();

  if (cleanRepos.length > 0) {
    lines.push('## Repositories with no open alerts');
    lines.push('');
    for (const name of cleanRepos) {
      lines.push(`- ${name}`);
    }
    lines.push('');
  }

  if (lines[lines.length - 1] !== '') {
    lines.push('');
  }

  return lines.join('\n');
}

function buildRepoSection(repo: RepoAlertsReport): string[] {
  const lines: string[] = [];
  const badges = [repo.archived ? '(archived)' : null, repo.isPrivate ? '(private)' : null]
    .filter((part): part is string => part !== null)
    .join(' ');
  const repoName = mdLink(repo.fullName, repo.htmlUrl);

  lines.push(`### ${repoName}${badges ? ` ${badges}` : ''}`);
  lines.push('');

  if (repo.dependabot.length > 0) {
    const sorted = sortAlerts(repo.dependabot);
    lines.push(`#### Dependabot alerts (${sorted.length})`);
    lines.push('');
    lines.push(tableRow(['Alert', 'Severity', 'Package', 'Summary', 'Created']));
    lines.push(tableRow(['-------', '---------', '-------', '--------', '--------']));
    for (const alert of sorted) {
      const pkg = [alert.ecosystem, alert.packageName].filter(Boolean).join(': ');
      const created = formatAlertDate(alert.createdAt);
      lines.push(
        tableRow([
          mdLink(`#${alert.number}`, alert.url),
          alert.severity,
          pkg,
          alert.summary,
          created,
        ]),
      );
    }
    lines.push('');
    for (const alert of sorted) {
      const details = dependabotDetails(alert);
      if (details.length > 0) {
        lines.push(`- #${alert.number} — ${details}`);
      }
    }
    lines.push('');
  }

  if (repo.codeScanning.length > 0) {
    const sorted = sortAlerts(repo.codeScanning);
    lines.push(`#### Code scanning alerts (${sorted.length})`);
    lines.push('');
    lines.push(tableRow(['Alert', 'Severity', 'Rule', 'Tool', 'Location', 'Created']));
    lines.push(tableRow(['-------', '---------', '------', '------', '---------', '--------']));
    for (const alert of sorted) {
      lines.push(
        tableRow([
          mdLink(`#${alert.number}`, alert.url),
          alert.severity,
          alert.ruleId,
          alert.ruleDescription,
          alert.tool,
          formatLocation(alert),
          formatAlertDate(alert.createdAt),
        ]),
      );
    }
    lines.push('');
  }

  if (repo.warnings.length > 0) {
    lines.push('#### Warnings');
    lines.push('');
    for (const warning of repo.warnings) {
      lines.push(`- ${escapeCell(warning)}`);
    }
    lines.push('');
  }

  return lines;
}

function dependabotDetails(alert: DependabotAlert): string {
  const parts: string[] = [];
  if (alert.ghsaId) parts.push(`advisory ${alert.ghsaId}`);
  if (alert.cveId) parts.push(`CVE ${alert.cveId}`);
  if (alert.manifestPath) parts.push(`manifest \`${alert.manifestPath}\``);
  if (alert.vulnerableRange) parts.push(`vulnerable \`${alert.vulnerableRange}\``);
  if (alert.patchedVersion) parts.push(`patched \`${alert.patchedVersion}\``);
  return parts.join(' · ');
}

function formatLocation(alert: CodeScanningAlert): string {
  if (!alert.path) {
    return '';
  }
  return alert.startLine !== null ? `${alert.path}:${alert.startLine}` : alert.path;
}

function sortAlerts<T extends { severity: AlertSeverity; number: number }>(alerts: T[]): T[] {
  return [...alerts].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.number - b.number,
  );
}

function severityRank(severity: AlertSeverity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

function formatAlertDate(createdAt: string | null): string {
  return createdAt && createdAt.length >= 10 ? createdAt.slice(0, 10) : '';
}

function tableRow(cells: string[]): string {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

function mdLink(label: string, url: string): string {
  return url ? `[${label}](${url})` : label;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
