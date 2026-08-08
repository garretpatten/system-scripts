import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
import { NotionApiClient } from './notion.js';
import { NotionExporter } from './notion-exporter.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface NotionBackupConfig {
  apiToken: string;
  homeDir: string;
  logDir: string;
  rateLimitDelayMs: number;
}

export class NotionBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: NotionBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const exportDate = formatBackupDate(date);
    const exportDirName = `Notion-Export_${exportDate}`;
    const exportDir = path.join(config.homeDir, exportDirName);
    const exportZip = path.join(config.homeDir, `${exportDirName}.zip`);
    const logFile = path.join(config.logDir, `notion-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `notion-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    if (await this.context.fs.exists(exportDir)) {
      await this.context.fs.rm(exportDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(exportDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Notion Workspace Export');
    logger.info(`Export directory: ${exportDir}`);
    logger.info(`Log: ${logFile}`);

    await this.checkDependencies(logger);

    const notionClient = new NotionApiClient(
      this.context.http,
      logger,
      config.apiToken,
      '2022-06-28',
      config.rateLimitDelayMs
    );
    const exporter = new NotionExporter(notionClient, this.context.fs, logger);

    logger.info('Discovering pages and databases...');
    const objects = await exporter.discoverObjects();
    logger.info(`Found ${objects.length} accessible objects`);

    if (objects.length === 0) {
      logger.warn(
        'No pages or databases found. Ensure your Notion integration has been added to your workspace content.'
      );
      return;
    }

    let exportedPages = 0;
    let exportedDatabases = 0;

    for (const object of objects) {
      const parentPath = exporter.getParentPath(object.id);
      const targetDir = path.join(exportDir, parentPath);
      await this.context.fs.mkdir(targetDir, { recursive: true });

      const safeTitle = sanitizeForFilename(object.title);
      const outputFile = await exporter.uniqueFilePath(targetDir, safeTitle, '.md');

      if (object.object === 'page') {
        logger.info(`Exporting page: ${object.title} -> ${outputFile}`);
        try {
          await exporter.exportPage(object.id, object.title, outputFile);
          exportedPages++;
        } catch (error) {
          logger.warn(`Failed to export page: ${object.title}: ${String(error)}`);
        }
      } else {
        logger.info(`Exporting database: ${object.title} -> ${outputFile}`);
        try {
          await exporter.exportDatabase(object.id, object.title, outputFile);
          exportedDatabases++;
        } catch (error) {
          logger.warn(`Failed to export database: ${object.title}: ${String(error)}`);
        }
      }
    }

    await this.createBackup(exportDirName, config.homeDir, logger);

    await this.context.fs.rm(exportDir, { recursive: true, force: true });

    logger.success('Notion export completed!');
    logger.info(`Pages exported: ${exportedPages}`);
    logger.info(`Databases exported: ${exportedDatabases}`);
    logger.info(`Archive: ${exportZip}`);
  }

  private async checkDependencies(logger: Logger): Promise<void> {
    logger.info('Checking dependencies...');
    const deps = ['curl', 'zip'];
    const missing: string[] = [];

    for (const dep of deps) {
      const result = await this.context.runner.run(dep, ['--version']);
      if (result.exitCode !== 0) {
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      logger.fatal(`Missing dependencies: ${missing.join(', ')}`);
    }

    logger.success('All dependencies found');
  }

  private async createBackup(exportDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating Notion export zip...');
    const outputFileName = `${exportDirName}.zip`;
    await this.context.archive.zipDirectory(exportDirName, outputFileName, cwd, [
      '*.DS_Store',
      '*.log',
    ]);
    logger.success(`Export created successfully: ${path.join(cwd, outputFileName)}`);
  }
}

function sanitizeForFilename(name: string): string {
  const withoutSlashes = name.replace(/[/\\]/g, '-').replace(/[\r\n]+/g, ' ');
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = withoutSlashes.replace(/[\x00-\x1f]/g, '');
  const trimmed = withoutControlChars.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled';
}

async function main(): Promise<void> {
  const fs = new RealFileSystem();
  const runner = new ProcessCommandRunner();
  const http = new NodeHttpClient();
  const archive = new ZipArchive(runner);
  const dateProvider = new SystemDateProvider();
  const logger = new ConsoleLogger();

  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  const projectRoot = path.resolve(srcDir, '..', '..');

  await loadEnvFile(fs, process.env, projectRoot);

  const apiToken = process.env.NOTION_API_TOKEN;
  if (!apiToken) {
    throw new Error('Set NOTION_API_TOKEN in env or .env');
  }

  const config: NotionBackupConfig = {
    apiToken,
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
    rateLimitDelayMs: parseFloat(process.env.NOTION_RATE_LIMIT_DELAY || '0.35') * 1000,
  };

  const context: BackupContext = {
    logger,
    fs,
    http,
    git: {
      clone: async () => undefined,
      remoteUpdate: async () => undefined,
      pushMirror: async () => undefined,
      checkout: async () => undefined,
      getDefaultBranch: async () => null,
    },
    sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
    archive,
    dateProvider,
    env: process.env,
    runner,
  };

  const backup = new NotionBackup(context);
  await backup.run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
     
    console.error(error);
    process.exit(1);
  });
}

export { main };
