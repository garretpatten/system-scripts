import path from 'node:path';
import { SecurityReport } from '../../src/security-report.js';
import { SecurityReportConfig, SecurityReportContext } from '../../src/types.js';
import {
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../../../backups/__tests__/test-helpers.js';

describe('SecurityReport', () => {
  let context: SecurityReportContext;
  let logger: MockLogger;
  let http: MockHttpClient;
  let fs: MockFileSystem;
  let config: SecurityReportConfig;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();

    context = {
      logger,
      fs,
      http,
      dateProvider: new MockDateProvider(new Date('2026-09-29T14:05:11Z')),
    };

    config = {
      token: 'gh-token',
      username: 'garretpatten',
      outputDir: '/home/user',
      logDir: '/logs',
    };
  });

  it('throws when no token is configured', async () => {
    await expect(new SecurityReport(context).run({ ...config, token: '' })).rejects.toThrow(
      'GitHub token is required: set GITHUB_SECURITY_TOKEN in env or .env',
    );
  });

  it('scans owned repositories and writes the dated report', async () => {
    http.setResponse(
      'GET',
      'https://api.github.com/user/repos?per_page=100&page=1&type=owner&sort=full_name',
      {
        statusCode: 200,
        body: JSON.stringify([
          {
            full_name: 'garretpatten/api',
            name: 'api',
            html_url: 'https://github.com/garretpatten/api',
            archived: false,
            private: false,
          },
          {
            full_name: 'garretpatten/quiet',
            name: 'quiet',
            html_url: 'https://github.com/garretpatten/quiet',
            archived: true,
            private: true,
          },
        ]),
      },
    );
    http.setResponse(
      'GET',
      'https://api.github.com/repos/garretpatten/api/dependabot/alerts?state=open&per_page=100',
      {
        statusCode: 200,
        body: JSON.stringify([
          {
            number: 7,
            state: 'open',
            dependency: { package: { ecosystem: 'npm', name: 'minimist' } },
            security_advisory: {
              summary: 'Prototype Pollution',
              severity: 'high',
              ghsa_id: 'GHSA-abcd',
            },
            html_url: 'https://github.com/garretpatten/api/security/dependabot/7',
            created_at: '2026-01-02T00:00:00Z',
          },
        ]),
      },
    );
    http.setResponse(
      'GET',
      'https://api.github.com/repos/garretpatten/quiet/dependabot/alerts?state=open&per_page=100',
      {
        statusCode: 200,
        body: JSON.stringify([]),
      },
    );
    http.setResponse(
      'GET',
      'https://api.github.com/repos/garretpatten/api/code-scanning/alerts?state=open&per_page=100&page=1',
      {
        statusCode: 200,
        body: JSON.stringify([
          {
            number: 3,
            state: 'open',
            rule: {
              id: 'js/tagged-template-literal-injection',
              description: 'Information exposure',
              severity: 'warning',
            },
            tool: { name: 'CodeQL' },
            most_recent_instance: { location: { path: 'src/log.ts', start_line: 9 } },
            html_url: 'https://github.com/garretpatten/api/security/code-scanning/3',
            created_at: '2026-03-04T00:00:00Z',
          },
        ]),
      },
    );
    http.setResponse(
      'GET',
      'https://api.github.com/repos/garretpatten/quiet/code-scanning/alerts?state=open&per_page=100&page=1',
      {
        statusCode: 403,
        body: JSON.stringify({
          message:
            'Code scanning is not enabled for private repositories without Advanced Security',
        }),
      },
    );

    const summary = await new SecurityReport(context).run(config);

    expect(summary.reportPath).toBe(
      path.join('/home/user', 'GitHub-Security-Report_2026-09-29.md'),
    );
    expect(summary.repositoriesScanned).toBe(2);
    expect(summary.dependabotAlerts).toBe(1);
    expect(summary.codeScanningAlerts).toBe(1);
    expect(summary.warnings).toBe(1);

    const report = fs.files.get(summary.reportPath);
    expect(report).toContain('# GitHub Security and Quality Report');
    expect(report).toContain('- **Open Dependabot alerts:** 1');
    expect(report).toContain('| **Total** | **1** | **1** | **2** |');
    expect(report).toContain(
      '### [garretpatten/quiet](https://github.com/garretpatten/quiet) (archived) (private)',
    );
    expect(report).toContain('npm: minimist');
    expect(report).toContain('src/log.ts:9');
    expect(report).toContain(
      '- Code scanning alerts unavailable (HTTP 403): Code scanning is not enabled for private repositories without Advanced Security',
    );
    expect(logger.messages.some((message) => message.level === 'SUCCESS')).toBe(true);
    expect(logger.messages.some((message) => message.level === 'WARN')).toBe(true);
  });

  it('logs the run to a timestamped log file', async () => {
    http.setResponse(
      'GET',
      'https://api.github.com/user/repos?per_page=100&page=1&type=owner&sort=full_name',
      {
        statusCode: 200,
        body: JSON.stringify([]),
      },
    );

    const summary = await new SecurityReport(context).run(config);

    expect(summary.reportPath).toBe(
      path.join('/home/user', 'GitHub-Security-Report_2026-09-29.md'),
    );
    const logFiles = [...fs.files.keys()].filter((file) => file.startsWith('/logs/'));
    expect(logFiles).toHaveLength(1);
    expect(logFiles[0]).toMatch(/^\/logs\/github-security-report-\d{8}-\d{6}\.log$/);
    expect(fs.files.get(logFiles[0])).toContain('Starting GitHub Security and Quality Report');
  });

  it('writes a report even when repositories are missing', async () => {
    http.setResponse(
      'GET',
      'https://api.github.com/user/repos?per_page=100&page=1&type=owner&sort=full_name',
      {
        statusCode: 200,
        body: JSON.stringify([]),
      },
    );

    const summary = await new SecurityReport(context).run(config);

    expect(summary.repositoriesScanned).toBe(0);
    const report = fs.files.get(summary.reportPath);
    expect(report).toContain('No open alerts were found.');
  });
});
