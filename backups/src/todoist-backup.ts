import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
import { TodoistApiClient } from './todoist.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface TodoistBackupConfig {
  apiToken: string;
  homeDir: string;
  logDir: string;
}

export class TodoistBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: TodoistBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const backupDate = formatBackupDate(date);
    const backupDirName = `Todoist-Export_${backupDate}`;
    const backupDir = path.join(config.homeDir, backupDirName);
    const backupZip = path.join(config.homeDir, `${backupDirName}.zip`);
    const logFile = path.join(config.logDir, `todoist-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `todoist-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    if (await this.context.fs.exists(backupDir)) {
      await this.context.fs.rm(backupDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(backupDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Todoist Backup');
    logger.info(`Backup directory: ${backupDir}`);
    logger.info(`Log: ${logFile}`);

    await this.checkDependencies(logger);

    const client = new TodoistApiClient(this.context.http, logger, config.apiToken);

    const tasks = await client.fetchTasks();
    await this.writeJson(backupDir, 'tasks.json', tasks, logger);

    const projects = await client.fetchProjects().catch(() => []);
    await this.writeJson(backupDir, 'projects.json', projects, logger);

    const labels = await client.fetchLabels().catch(() => []);
    await this.writeJson(backupDir, 'labels.json', labels, logger);

    await this.createBackup(backupDirName, config.homeDir, logger);

    logger.success('Todoist backup completed!');
    logger.info(`Tasks backed up: ${tasks.length}`);
    logger.info(`Archive: ${backupZip}`);

    await this.context.fs.rm(backupDir, { recursive: true, force: true });
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

  private async writeJson(
    backupDir: string,
    filename: string,
    data: unknown[],
    logger: Logger
  ): Promise<void> {
    const filePath = path.join(backupDir, filename);
    await this.context.fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.success(`Saved ${data.length} ${filename.replace('.json', '')}`);
  }

  private async createBackup(backupDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating Todoist backup zip...');
    const outputFileName = `${backupDirName}.zip`;
    await this.context.archive.zipDirectory(backupDirName, outputFileName, cwd);
    logger.success(`Backup created successfully: ${path.join(cwd, outputFileName)}`);
  }
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

  const apiToken = process.env.TODOIST_API_TOKEN;
  if (!apiToken) {
    throw new Error('Set TODOIST_API_TOKEN in env or .env');
  }

  const config: TodoistBackupConfig = {
    apiToken,
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
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

  const backup = new TodoistBackup(context);
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
