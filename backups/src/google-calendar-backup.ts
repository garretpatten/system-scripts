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
import { GoogleCalendarApiClient } from './google-calendar.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp, sanitizeFilename } from './utils.js';

export interface GoogleCalendarBackupConfig {
  credentials: GoogleOAuthCredentials;
  homeDir: string;
  logDir: string;
  showDeleted: boolean;
}

export class GoogleCalendarBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: GoogleCalendarBackupConfig): Promise<void> {
    this.validateCredentials(config);

    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const exportDate = formatBackupDate(date);
    const exportDirName = `Google-Calendar-Export_${exportDate}`;
    const exportDir = path.join(config.homeDir, exportDirName);
    const exportZip = path.join(config.homeDir, `${exportDirName}.zip`);
    const logFile = path.join(config.logDir, `google-calendar-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `google-calendar-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    if (await this.context.fs.exists(exportDir)) {
      await this.context.fs.rm(exportDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(exportDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Google Calendar Export');
    logger.info(`Export directory: ${exportDir}`);
    logger.info(`Log: ${logFile}`);

    await this.checkDependencies(logger);

    const auth = new GoogleAuthClient(this.context.http, logger, config.credentials);
    const client = new GoogleCalendarApiClient(this.context.http, logger, auth);

    const calendars = await client.fetchCalendars();
    await this.writeJson(exportDir, 'calendars.json', calendars, logger);

    const usedDirNames = new Set<string>();
    let totalEvents = 0;

    for (const calendar of calendars) {
      const record = this.asRecord(calendar);
      const summary = typeof record.summary === 'string' ? record.summary : 'calendar';
      const calendarId = typeof record.id === 'string' ? record.id : '';
      const calendarDir = path.join(exportDir, this.uniqueDirName(summary, usedDirNames));
      await this.context.fs.mkdir(calendarDir, { recursive: true });
      await this.writeJson(calendarDir, 'calendar.json', calendar, logger);

      const events = await this.fetchEvents(client, calendarId, summary, config, logger);
      await this.writeJson(calendarDir, 'events.json', events, logger);
      totalEvents += events.length;
    }

    await this.createBackup(exportDirName, config.homeDir, logger);

    logger.success('Google Calendar export completed!');
    logger.info(`Calendars backed up: ${calendars.length}`);
    logger.info(`Events backed up: ${totalEvents}`);
    logger.info(`Archive: ${exportZip}`);

    await this.context.fs.rm(exportDir, { recursive: true, force: true });
  }

  private validateCredentials(config: GoogleCalendarBackupConfig): void {
    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId || !clientSecret) {
      throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env or .env');
    }
    if (!refreshToken) {
      throw new Error(
        'Missing GOOGLE_REFRESH_TOKEN. Run `npm run backup:google-calendar` once ' +
          'interactively to authorize, or set GOOGLE_REFRESH_TOKEN in env or .env',
      );
    }
  }

  private async fetchEvents(
    client: GoogleCalendarApiClient,
    calendarId: string,
    summary: string,
    config: GoogleCalendarBackupConfig,
    logger: Logger,
  ): Promise<unknown[]> {
    if (!calendarId) {
      logger.warn(`Skipping events for calendar without an id: ${summary}`);
      return [];
    }
    try {
      return await client.fetchEvents(calendarId, { showDeleted: config.showDeleted });
    } catch (error) {
      logger.warn(`Failed to export events for calendar: ${summary}: ${String(error)}`);
      return [];
    }
  }

  private uniqueDirName(summary: string, usedDirNames: Set<string>): string {
    const base = sanitizeFilename(summary);
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
    logger.info('Creating Google Calendar export zip...');
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

  const config: GoogleCalendarBackupConfig = {
    credentials,
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
    showDeleted: (process.env.GOOGLE_CALENDAR_SHOW_DELETED || 'false').toLowerCase() === 'true',
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

  const backup = new GoogleCalendarBackup(context);
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
