import { loadEnvFile, saveEnvValue } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
import {
  GoogleAuthClient,
  GoogleAuthorizer,
  GoogleOAuthCredentials,
  LoopbackRedirectListener,
} from './google-auth.js';
import { GoogleTasksApiClient } from './google-tasks.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp, sanitizeFilename } from './utils.js';

export interface GoogleTasksBackupConfig {
  credentials: GoogleOAuthCredentials;
  homeDir: string;
  logDir: string;
  showCompleted: boolean;
  showDeleted: boolean;
  showHidden: boolean;
}

export class GoogleTasksBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: GoogleTasksBackupConfig): Promise<void> {
    this.validateCredentials(config);

    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const exportDate = formatBackupDate(date);
    const exportDirName = `Google-Tasks-Export_${exportDate}`;
    const exportDir = path.join(config.homeDir, exportDirName);
    const exportZip = path.join(config.homeDir, `${exportDirName}.zip`);
    const logFile = path.join(config.logDir, `google-tasks-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `google-tasks-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    if (await this.context.fs.exists(exportDir)) {
      await this.context.fs.rm(exportDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(exportDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Google Tasks Export');
    logger.info(`Export directory: ${exportDir}`);
    logger.info(`Log: ${logFile}`);

    await this.checkDependencies(logger);

    const auth = new GoogleAuthClient(this.context.http, logger, config.credentials);
    const client = new GoogleTasksApiClient(this.context.http, logger, auth);

    const taskLists = await client.fetchTaskLists();
    await this.writeJson(exportDir, 'task-lists.json', taskLists, logger);

    const usedDirNames = new Set<string>();
    let totalTasks = 0;

    for (const taskList of taskLists) {
      const record = this.asRecord(taskList);
      const title = typeof record.title === 'string' ? record.title : 'task-list';
      const taskListId = typeof record.id === 'string' ? record.id : '';
      const taskListDir = path.join(exportDir, this.uniqueDirName(title, usedDirNames));
      await this.context.fs.mkdir(taskListDir, { recursive: true });
      await this.writeJson(taskListDir, 'task-list.json', taskList, logger);

      const tasks = await this.fetchTasks(client, taskListId, title, config, logger);
      await this.writeJson(taskListDir, 'tasks.json', tasks, logger);
      totalTasks += tasks.length;
    }

    await this.createBackup(exportDirName, config.homeDir, logger);

    logger.success('Google Tasks export completed!');
    logger.info(`Task lists backed up: ${taskLists.length}`);
    logger.info(`Tasks backed up: ${totalTasks}`);
    logger.info(`Archive: ${exportZip}`);

    await this.context.fs.rm(exportDir, { recursive: true, force: true });
  }

  private validateCredentials(config: GoogleTasksBackupConfig): void {
    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId || !clientSecret) {
      throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env or .env');
    }
    if (!refreshToken) {
      throw new Error(
        'Missing GOOGLE_REFRESH_TOKEN. Run `npm run backup:google-tasks` once ' +
          'interactively to authorize, or set GOOGLE_REFRESH_TOKEN in env or .env',
      );
    }
  }

  private async fetchTasks(
    client: GoogleTasksApiClient,
    taskListId: string,
    title: string,
    config: GoogleTasksBackupConfig,
    logger: Logger,
  ): Promise<unknown[]> {
    if (!taskListId) {
      logger.warn(`Skipping tasks for task list without an id: ${title}`);
      return [];
    }
    try {
      return await client.fetchTasks(taskListId, {
        showCompleted: config.showCompleted,
        showDeleted: config.showDeleted,
        showHidden: config.showHidden,
      });
    } catch (error) {
      logger.warn(`Failed to export tasks for task list: ${title}: ${String(error)}`);
      return [];
    }
  }

  private uniqueDirName(title: string, usedDirNames: Set<string>): string {
    const base = sanitizeFilename(title);
    let candidate = base;
    let counter = 2;
    while (usedDirNames.has(candidate)) {
      candidate = `${base}_${counter}`;
      counter++;
    }
    usedDirNames.add(candidate);
    return candidate;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  }

  private async checkDependencies(logger: Logger): Promise<void> {
    logger.info('Checking dependencies...');
    const result = await this.context.runner.run('zip', ['--version']);
    if (result.exitCode !== 0) {
      logger.fatal('Missing required dependency: zip');
    }
    logger.success('All dependencies found');
  }

  private async writeJson(
    dir: string,
    filename: string,
    data: unknown,
    logger: Logger,
  ): Promise<void> {
    const filePath = path.join(dir, filename);
    await this.context.fs.writeFile(filePath, JSON.stringify(data, null, 2));
    const label = filename.replace('.json', '');
    if (Array.isArray(data)) {
      logger.success(`Saved ${data.length} ${label}`);
    } else {
      logger.success(`Saved ${label}`);
    }
  }

  private async createBackup(exportDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating Google Tasks export zip...');
    const outputFileName = `${exportDirName}.zip`;
    await this.context.archive.zipDirectory(exportDirName, outputFileName, cwd);
    logger.success(`Export created successfully: ${path.join(cwd, outputFileName)}`);
  }
}

function loadCredentials(env: NodeJS.ProcessEnv): GoogleOAuthCredentials {
  return {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: env.GOOGLE_REFRESH_TOKEN || '',
  };
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

  const credentials = loadCredentials(process.env);
  if (!credentials.refreshToken) {
    const authorizer = new GoogleAuthorizer(http, logger, new LoopbackRedirectListener());
    credentials.refreshToken = await authorizer.authorize(credentials);
    await saveEnvValue(fs, projectRoot, 'GOOGLE_REFRESH_TOKEN', credentials.refreshToken);
    logger.success('Saved GOOGLE_REFRESH_TOKEN to .env');
  }

  const config: GoogleTasksBackupConfig = {
    credentials,
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
    showCompleted: (process.env.GOOGLE_TASKS_SHOW_COMPLETED || 'true').toLowerCase() !== 'false',
    showDeleted: (process.env.GOOGLE_TASKS_SHOW_DELETED || 'true').toLowerCase() !== 'false',
    showHidden: (process.env.GOOGLE_TASKS_SHOW_HIDDEN || 'true').toLowerCase() !== 'false',
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

  const backup = new GoogleTasksBackup(context);
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
