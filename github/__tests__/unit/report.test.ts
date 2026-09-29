import { buildSecurityReport, summarizeAlerts } from '../../src/report.js';
import { CodeScanningAlert, DependabotAlert, RepoAlertsReport } from '../../src/types.js';

function dependabotAlert(overrides: Partial<DependabotAlert> = {}): DependabotAlert {
  return {
    number: 1,
    state: 'open',
    severity: 'high',
    ecosystem: 'npm',
    packageName: 'lodash',
    manifestPath: 'package-lock.json',
    ghsaId: 'GHSA-abcd-abcd-abcd',
    cveId: 'CVE-2020-8203',
    summary: 'Prototype pollution in lodash',
    vulnerableRange: '< 4.17.21',
    patchedVersion: '4.17.21',
    createdAt: '2020-08-15T00:00:00Z',
    url: 'https://github.com/garretpatten/api/security/dependabot/1',
    ...overrides,
  };
}

function codeScanningAlert(overrides: Partial<CodeScanningAlert> = {}): CodeScanningAlert {
  return {
    number: 1,
    state: 'open',
    severity: 'medium',
    ruleId: 'js/xss',
    ruleDescription: 'Cross-site scripting',
    tool: 'CodeQL',
    path: 'src/app.ts',
    startLine: 42,
    createdAt: '2025-02-01T00:00:00Z',
    url: 'https://github.com/garretpatten/api/security/code-scanning/1',
    ...overrides,
  };
}

function repoReport(overrides: Partial<RepoAlertsReport> = {}): RepoAlertsReport {
  return {
    fullName: 'garretpatten/api',
    htmlUrl: 'https://github.com/garretpatten/api',
    archived: false,
    isPrivate: false,
    dependabot: [],
    codeScanning: [],
    warnings: [],
    ...overrides,
  };
}

describe('buildSecurityReport', () => {
  const input = {
    generatedAt: new Date('2026-09-29T14:02:31Z'),
    username: 'garretpatten',
  };

  it('renders the header with profile, generation date and alert counts', () => {
    const report = buildSecurityReport({
      ...input,
      repos: [repoReport({ dependabot: [dependabotAlert()], codeScanning: [codeScanningAlert()] })],
    });

    expect(report).toContain('# GitHub Security and Quality Report');
    expect(report).toContain('- **Profile:** garretpatten');
    expect(report).toContain('- **Generated:** 2026-09-29 14:02:31 UTC');
    expect(report).toContain('- **Repositories scanned:** 1');
    expect(report).toContain('- **Open Dependabot alerts:** 1');
    expect(report).toContain('- **Open code scanning alerts:** 1');
  });

  it('builds a severity summary table with totals', () => {
    const report = buildSecurityReport({
      ...input,
      repos: [
        repoReport({
          dependabot: [
            dependabotAlert({ severity: 'critical', number: 1 }),
            dependabotAlert({ severity: 'low', number: 2 }),
          ],
          codeScanning: [
            codeScanningAlert({ severity: 'high', number: 3 }),
            codeScanningAlert({ severity: 'critical', number: 4 }),
          ],
        }),
      ],
    });

    expect(report).toContain('| Severity | Dependabot | Code scanning | Total |');
    expect(report).toContain('| critical | 1 | 1 | 2 |');
    expect(report).toContain('| high | 0 | 1 | 1 |');
    expect(report).toContain('| low | 1 | 0 | 1 |');
    expect(report).toContain('| **Total** | **2** | **2** | **4** |');
  });

  it('lists repos with alerts before listing clean repositories', () => {
    const report = buildSecurityReport({
      ...input,
      repos: [
        repoReport({
          fullName: 'garretpatten/beta',
          htmlUrl: 'https://github.com/garretpatten/beta',
          dependabot: [dependabotAlert()],
        }),
        repoReport({ fullName: 'garretpatten/alpha' }),
      ],
    });

    const betaSection = report.indexOf(
      '### [garretpatten/beta](https://github.com/garretpatten/beta)',
    );
    const dependabotTable = report.indexOf('#### Dependabot alerts (1)');
    const cleanSection = report.indexOf('## Repositories with no open alerts');
    const alphaItem = report.indexOf('- garretpatten/alpha');

    expect(betaSection).toBeGreaterThan(0);
    expect(dependabotTable).toBeGreaterThan(betaSection);
    expect(cleanSection).toBeGreaterThan(dependabotTable);
    expect(alphaItem).toBeGreaterThan(cleanSection);
  });

  it('links alerts and includes alert detail metadata', () => {
    const report = buildSecurityReport({
      ...input,
      repos: [repoReport({ dependabot: [dependabotAlert()], codeScanning: [codeScanningAlert()] })],
    });

    expect(report).toContain(
      '[#1](https://github.com/garretpatten/api/security/dependabot/1) | high | npm: lodash | Prototype pollution in lodash | 2020-08-15',
    );
    expect(report).toContain(
      '- #1 — advisory GHSA-abcd-abcd-abcd · CVE CVE-2020-8203 · manifest `package-lock.json` · vulnerable `< 4.17.21` · patched `4.17.21`',
    );
    expect(report).toContain(
      '[#1](https://github.com/garretpatten/api/security/code-scanning/1) | medium | js/xss | Cross-site scripting | CodeQL | src/app.ts:42 | 2025-02-01',
    );
  });

  it('marks archived and private repositories', () => {
    const report = buildSecurityReport({
      ...input,
      repos: [repoReport({ archived: true, isPrivate: true, dependabot: [dependabotAlert()] })],
    });

    expect(report).toContain(
      '### [garretpatten/api](https://github.com/garretpatten/api) (archived) (private)',
    );
  });

  it('escapes pipe characters in alert summaries', () => {
    const report = buildSecurityReport({
      ...input,
      repos: [repoReport({ dependabot: [dependabotAlert({ summary: 'Broken | pipes' })] })],
    });

    expect(report).toContain('Broken \\| pipes');
  });

  it('records warnings per repository', () => {
    const report = buildSecurityReport({
      ...input,
      repos: [repoReport({ warnings: ['Code scanning alerts unavailable (HTTP 403): Forbidden'] })],
    });

    expect(report).toContain('#### Warnings');
    expect(report).toContain('- Code scanning alerts unavailable (HTTP 403): Forbidden');
    expect(report).not.toContain('## Repositories with no open alerts');
  });

  it('renders a report without tables when there is nothing to show', () => {
    const report = buildSecurityReport({ ...input, repos: [] });

    expect(report).toContain('No open alerts were found.');
    expect(report).not.toContain('| Severity | Dependabot | Code scanning | Total |');
  });
});

describe('summarizeAlerts', () => {
  it('counts alerts per severity and alert type', () => {
    const totals = summarizeAlerts([
      repoReport({
        dependabot: [
          dependabotAlert({ severity: 'critical' }),
          dependabotAlert({ severity: 'medium' }),
        ],
        codeScanning: [
          codeScanningAlert({ severity: 'high' }),
          codeScanningAlert({ severity: 'unknown' }),
        ],
      }),
      repoReport({
        fullName: 'garretpatten/other',
        dependabot: [dependabotAlert({ severity: 'low' })],
      }),
    ]);

    expect(totals.dependabot).toEqual({ critical: 1, high: 0, medium: 1, low: 1, unknown: 0 });
    expect(totals.codeScanning).toEqual({ critical: 0, high: 1, medium: 0, low: 0, unknown: 1 });
    expect(totals.dependabotTotal).toBe(3);
    expect(totals.codeScanningTotal).toBe(2);
  });
});
