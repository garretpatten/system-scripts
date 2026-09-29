import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '../../backups/src/types.js';
import { loadEnvFile } from '../../backups/src/env.js';
import { RealFileSystem } from '../../backups/src/fs.js';
import { NodeHttpClient } from '../../backups/src/http.js';
import { ConsoleLogger, FileLogger } from '../../backups/src/logger.js';
import { SystemDateProvider } from '../../backups/src/date.js';
import { formatBackupDate, formatRunTimestamp } from '../../backups/src/utils.js';
import { GitHubAlertsClient, GitHubSecurityApiError } from './alerts.js';
import { buildSecurityReport } from './report.js';
import {
  OwnedRepository,
  RepoAlertsReport,
  SecurityReportConfig,
  SecurityReportContext,
  SecurityReportSummary,
} from './types.js';

export class SecurityReport {
  constructor(private readonly context: SecurityReportContext) {}

  async run(config: SecurityReportConfig): Promise<SecurityReportSummary> {
    if (!config.token) {
      throw new Error('GitHub token is required: set GITHUB_SECURITY_TOKEN in env or .env');
    }

    const now = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(now);
    const reportDate = formatBackupDate(now);

    await this.context.fs.mkdir(config.outputDir, { recursive: true });
    await this.context.fs.mkdir(config.logDir, { recursive: true });

    const logFile = path.join(config.logDir, `github-security-report-${runTs}.log`);
    const logger: Logger = new FileLogger(this.context.logger, this.context.fs, logFile);

    logger.info('Starting GitHub Security and Quality Report');
    logger.info(`Profile: ${config.username}`);
    logger.info(`Log file: ${logFile}`);

    const client = new GitHubAlertsClient(this.context.http, logger, config.token);

    const repoReports: RepoAlertsReport[] = [];
    let reposWithAlerts = 0;
    let dependabotAlerts = 0;
    let codeScanningAlerts = 0;
    let warnings = 0;

    for await (const repo of client.listOwnedRepos()) {
      logger.info(`Scanning ${repo.fullName}${repo.archived ? ' (archived)' : ''}...`);
      const report = await this.scanRepository(client, repo, logger);

      if (report.dependabot.length > 0 || report.codeScanning.length > 0) {
        reposWithAlerts++;
        logger.info(
          `Found ${report.dependabot.length} Dependabot and ${report.codeScanning.length} code scanning alerts for ${repo.fullName}`,
        );
      }

      repoReports.push(report);
      dependabotAlerts += report.dependabot.length;
      codeScanningAlerts += report.codeScanning.length;
      warnings += report.warnings.length;
    }

    logger.info(`Scanned ${repoReports.length} repositories`);

    const markdown = buildSecurityReport({
      generatedAt: now,
      username: config.username,
      repos: repoReports,
    });

    const reportPath = path.join(config.outputDir, `GitHub-Security-Report_${reportDate}.md`);
    await this.context.fs.writeFile(reportPath, markdown);

    logger.success('Report completed!');
    logger.info(`Open Dependabot alerts: ${dependabotAlerts}`);
    logger.info(`Open code scanning alerts: ${codeScanningAlerts}`);
    logger.info(`Repositories with alerts: ${reposWithAlerts} of ${repoReports.length}`);
    logger.info(`Report: ${reportPath}`);

    if (warnings > 0) {
      logger.warn('One or more alert sources could not be read. Check the warnings in the report.');
    }

    return {
      reportPath,
      repositoriesScanned: repoReports.length,
      repositoriesWithAlerts: reposWithAlerts,
      dependabotAlerts,
      codeScanningAlerts,
      warnings,
    };
  }

  private async scanRepository(
    client: GitHubAlertsClient,
    repo: OwnedRepository,
    logger: Logger,
  ): Promise<RepoAlertsReport> {
    const report: RepoAlertsReport = {
      fullName: repo.fullName,
      htmlUrl: repo.htmlUrl,
      archived: repo.archived,
      isPrivate: repo.isPrivate,
      dependabot: [],
      codeScanning: [],
      warnings: [],
    };

    try {
      report.dependabot = await client.listDependabotAlerts(repo.fullName);
    } catch (error) {
      const message = this.describeError(error, 'Dependabot alerts');
      report.warnings.push(message);
      logger.warn(`${repo.fullName}: ${message}`);
    }

    try {
      report.codeScanning = await client.listCodeScanningAlerts(repo.fullName);
    } catch (error) {
      const message = this.describeError(error, 'Code scanning alerts');
      report.warnings.push(message);
      logger.warn(`${repo.fullName}: ${message}`);
    }

    return report;
  }

  private describeError(error: unknown, source: string): string {
    if (error instanceof GitHubSecurityApiError) {
      return `${source} unavailable (HTTP ${error.statusCode}): ${error.message}`;
    }
    return `${source} failed: ${String(error)}`;
  }
}

async function main(): Promise<void> {
  const fs = new RealFileSystem();
  const http = new NodeHttpClient();
  const dateProvider = new SystemDateProvider();
  const logger = new ConsoleLogger();

  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  const projectRoot = path.resolve(srcDir, '..', '..');

  await loadEnvFile(fs, process.env, projectRoot);

  const config: SecurityReportConfig = {
    token: process.env.GITHUB_SECURITY_TOKEN || process.env.GITHUB_TOKEN || '',
    username: process.env.GITHUB_SECURITY_USERNAME || 'garretpatten',
    outputDir:
      process.env.GITHUB_SECURITY_REPORT_DIR || process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'github', 'logs'),
  };

  const context: SecurityReportContext = { logger, fs, http, dateProvider };

  const report = new SecurityReport(context);
  await report.run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
