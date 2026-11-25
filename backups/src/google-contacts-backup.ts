import { createBackupContext } from './backup-context.js';
import { checkDependencies } from './dependencies.js';
import { saveEnvValue } from './env.js';
import { storeArchive } from './export-dir.js';
import { FileLogger } from './logger.js';
import {
  GoogleAuth,
  GoogleAuthClient,
  GoogleAuthManager,
  GoogleAuthorizer,
  GoogleOAuthCredentials,
  LoopbackRedirectListener,
} from './google-auth.js';
import { GoogleApiError } from './google-api-error.js';
import { GoogleContactsApiClient } from './google-contacts.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface GoogleContactsBackupConfig {
  credentials: GoogleOAuthCredentials;
  homeDir: string;
  logDir: string;
  projectRoot?: string;
}

export class GoogleContactsBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: GoogleContactsBackupConfig): Promise<void> {
    this.validateCredentials(config);

    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const exportDate = formatBackupDate(date);
    const exportDirName = `Google-Contacts-Export_${exportDate}`;
    const exportDir = path.join(config.homeDir, exportDirName);
    const exportZip = path.join(config.homeDir, `${exportDirName}.zip`);
    const logFile = path.join(config.logDir, `google-contacts-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `google-contacts-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    if (await this.context.fs.exists(exportDir)) {
      await this.context.fs.rm(exportDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(exportDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Google Contacts Export');
    logger.info(`Export directory: ${exportDir}`);
    logger.info(`Log: ${logFile}`);

    await checkDependencies(this.context.runner, ['zip'], logger);

    const auth = this.createAuth(config, logger);
    const client = new GoogleContactsApiClient(this.context.http, logger, auth);

    const collections = [
      {
        label: 'Contacts',
        count: await this.exportCollection(
          () => client.fetchContacts(),
          'contacts.json',
          'contacts',
          exportDir,
          logger,
        ),
      },
      {
        label: 'Contact groups',
        count: await this.exportCollection(
          () => client.fetchContactGroups(),
          'contact-groups.json',
          'contact groups',
          exportDir,
          logger,
        ),
      },
      {
        label: 'Other contacts',
        count: await this.exportCollection(
          () => client.fetchOtherContacts(),
          'other-contacts.json',
          'other contacts',
          exportDir,
          logger,
        ),
      },
    ];
    const failedExports = collections.filter((collection) => collection.count === null).length;

    if (failedExports > 0) {
      logger.warn(`Some collections failed to export. Check error log: ${errorLog}`);
      process.exitCode = 1;
    }

    if (failedExports === collections.length) {
      logger.warn('No collections could be exported; skipping zip creation');
      await this.context.fs.rm(exportDir, { recursive: true, force: true });
      return;
    }

    await this.createBackup(exportDirName, config.homeDir, logger);

    const archivePath = await storeArchive(
      this.context.fs,
      this.context.env,
      logger,
      exportZip,
      config.homeDir,
      date,
    );

    logger.success('Google Contacts export completed!');
    for (const collection of collections) {
      logger.info(`${collection.label} backed up: ${collection.count ?? 0}`);
    }
    logger.info(`Archive: ${archivePath}`);

    await this.context.fs.rm(exportDir, { recursive: true, force: true });
  }

  private validateCredentials(config: GoogleContactsBackupConfig): void {
    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId || !clientSecret) {
      throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env or .env');
    }
    if (!refreshToken) {
      throw new Error(
        'Missing GOOGLE_REFRESH_TOKEN. Run `npm run backup:google-contacts` once ' +
          'interactively to authorize, or set GOOGLE_REFRESH_TOKEN in env or .env',
      );
    }
  }

  private createAuth(config: GoogleContactsBackupConfig, logger: Logger): GoogleAuth {
    if (config.projectRoot) {
      return new GoogleAuthManager(
        this.context.http,
        this.context.fs,
        logger,
        new GoogleAuthorizer(this.context.http, logger, new LoopbackRedirectListener()),
        {
          credentials: config.credentials,
          projectRoot: config.projectRoot,
        },
      );
    }

    return new GoogleAuthClient(this.context.http, logger, config.credentials);
  }

  /**
   * Fetches one People API collection and writes it as pretty-printed JSON.
   * A failed collection is logged to the error log and returns null so the
   * run fails loudly instead of writing an empty export.
   */
  private async exportCollection(
    fetch: () => Promise<unknown[]>,
    filename: string,
    label: string,
    exportDir: string,
    logger: Logger,
  ): Promise<number | null> {
    try {
      const items = await fetch();
      await this.writeJson(exportDir, filename, items, logger);
      return items.length;
    } catch (error) {
      logger.error(`Failed to export ${label}: ${String(error)}`);
      if (error instanceof GoogleApiError && error.statusCode === 403) {
        logger.error(
          'The saved GOOGLE_REFRESH_TOKEN may predate the contacts.readonly scopes, ' +
            'or the People API is not enabled for the OAuth project. Remove ' +
            'GOOGLE_REFRESH_TOKEN from .env and run `npm run backup:google-contacts` once ' +
            'interactively to re-authorize; also enable the People API in the Google Cloud Console.',
        );
      }
      return null;
    }
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
    logger.info('Creating Google Contacts export zip...');
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
  const { context, projectRoot } = await createBackupContext();

  const credentials = loadCredentials(process.env);
  if (!credentials.refreshToken) {
    const authorizer = new GoogleAuthorizer(
      context.http,
      context.logger,
      new LoopbackRedirectListener(),
    );
    credentials.refreshToken = await authorizer.authorize(credentials);
    await saveEnvValue(context.fs, projectRoot, 'GOOGLE_REFRESH_TOKEN', credentials.refreshToken);
    context.logger.success('Saved GOOGLE_REFRESH_TOKEN to .env');
  }

  const config: GoogleContactsBackupConfig = {
    credentials,
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
    projectRoot,
  };

  await new GoogleContactsBackup(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
