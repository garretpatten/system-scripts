import { createBackupContext, resolveProjectRoot } from './backup-context.js';
import { FileLogger } from './logger.js';
import { LocalBackup, LocalBackupConfig } from './local-backup.js';
import { GitLabMirror, GitLabMirrorConfig } from './gitlab-mirror.js';
import { NotionBackup, NotionBackupConfig } from './notion-backup.js';
import { BraveBookmarksBackup, BraveBookmarksBackupConfig } from './brave-bookmarks-backup.js';
import { ChromeBookmarksBackup, ChromeBookmarksBackupConfig } from './chrome-bookmarks-backup.js';
import { ObsidianNotesBackup, ObsidianNotesBackupConfig } from './obsidian-notes-backup.js';
import { GoogleCalendarBackup, GoogleCalendarBackupConfig } from './google-calendar-backup.js';
import { GoogleTasksBackup, GoogleTasksBackupConfig } from './google-tasks-backup.js';
import { GoogleContactsBackup, GoogleContactsBackupConfig } from './google-contacts-backup.js';
import { GoogleOAuthCredentials } from './google-auth.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRunTimestamp } from './utils.js';

interface RunAllConfig {
  homeDir: string;
  logDir: string;
}

/** Per-backup outcome: ran and succeeded, ran and failed, or never ran. */
type RunStatus = 'ok' | 'failed' | 'skipped';

export class BackupOrchestrator {
  constructor(private readonly context: BackupContext) {}

  async run(config: RunAllConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const logFile = path.join(config.logDir, `backups-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile);

    logger.info('Starting all backups');
    logger.info(`Log: ${logFile}`);

    const results: Record<string, RunStatus> = {};

    results['code-local'] = await this.runLocalBackup(logger);
    results['code-gitlab'] = await this.runGitlabMirror(logger);
    results['notion'] = await this.runNotionBackup(logger);
    results['brave-bookmarks'] = await this.runBraveBookmarksBackup(logger);
    results['chrome-bookmarks'] = await this.runChromeBookmarksBackup(logger);
    results['obsidian-notes'] = await this.runObsidianNotesBackup(logger);
    results['google-calendar'] = await this.runGoogleCalendarBackup(logger);
    results['google-tasks'] = await this.runGoogleTasksBackup(logger);
    results['google-contacts'] = await this.runGoogleContactsBackup(logger);

    logger.info('Backup summary:');
    for (const [name, status] of Object.entries(results)) {
      logger.info(`  ${name.padEnd(17)}: ${status.toUpperCase()}`);
    }

    if (Object.values(results).some((status) => status === 'failed')) {
      logger.warn(`One or more backups failed. See: ${logFile}`);
      process.exitCode = 1;
    } else {
      logger.success('All backups completed successfully');
    }
  }

  private async runLocalBackup(logger: Logger): Promise<RunStatus> {
    try {
      const config: LocalBackupConfig = {
        githubToken: this.context.env.GITHUB_TOKEN || undefined,
        githubUsername: this.context.env.GITHUB_USERNAME || undefined,
        useSsh: (this.context.env.USE_GITHUB_SSH || 'false').toLowerCase() === 'true',
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new LocalBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: code-local: ${String(error)}`);
      return 'failed';
    }
  }

  private async runGitlabMirror(logger: Logger): Promise<RunStatus> {
    // Skip rather than run with empty credentials, which would fail every
    // API call with confusing errors.
    if (!this.context.env.GITLAB_TOKEN || !this.context.env.GITLAB_NAMESPACE) {
      logger.warn('Skipping code-gitlab: GITLAB_TOKEN and GITLAB_NAMESPACE are not configured');
      return 'skipped';
    }

    try {
      const config: GitLabMirrorConfig = {
        githubToken: this.context.env.GITHUB_TOKEN || undefined,
        githubUsername: this.context.env.GITHUB_USERNAME || undefined,
        useSsh: (this.context.env.USE_GITHUB_SSH || 'false').toLowerCase() === 'true',
        gitlabToken: this.context.env.GITLAB_TOKEN,
        gitlabNamespace: this.context.env.GITLAB_NAMESPACE,
        autoCreateProjects:
          (this.context.env.AUTO_CREATE_GITLAB_PROJECTS || 'true').toLowerCase() === 'true',
        gitlabVisibility: this.context.env.GITLAB_VISIBILITY || 'private',
        gitlabHost: this.context.env.GITLAB_HOST || 'https://gitlab.com',
        backupRoot:
          this.context.env.BACKUP_ROOT ||
          path.join(this.context.env.HOME || '.', 'GitHub-GitLab-Backup'),
      };
      await new GitLabMirror(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: code-gitlab: ${String(error)}`);
      return 'failed';
    }
  }

  private async runNotionBackup(logger: Logger): Promise<RunStatus> {
    if (!this.context.env.NOTION_API_TOKEN) {
      logger.warn('Skipping notion: NOTION_API_TOKEN is not configured');
      return 'skipped';
    }

    try {
      const config: NotionBackupConfig = {
        apiToken: this.context.env.NOTION_API_TOKEN,
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
        rateLimitDelayMs: parseFloat(this.context.env.NOTION_RATE_LIMIT_DELAY || '0.35') * 1000,
      };
      await new NotionBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: notion: ${String(error)}`);
      return 'failed';
    }
  }

  private async runBraveBookmarksBackup(logger: Logger): Promise<RunStatus> {
    try {
      const config: BraveBookmarksBackupConfig = {
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new BraveBookmarksBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: brave-bookmarks: ${String(error)}`);
      return 'failed';
    }
  }

  private async runChromeBookmarksBackup(logger: Logger): Promise<RunStatus> {
    try {
      const config: ChromeBookmarksBackupConfig = {
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new ChromeBookmarksBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: chrome-bookmarks: ${String(error)}`);
      return 'failed';
    }
  }

  private async runObsidianNotesBackup(logger: Logger): Promise<RunStatus> {
    try {
      const config: ObsidianNotesBackupConfig = {
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new ObsidianNotesBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: obsidian-notes: ${String(error)}`);
      return 'failed';
    }
  }

  private async runGoogleCalendarBackup(logger: Logger): Promise<RunStatus> {
    try {
      const config: GoogleCalendarBackupConfig = {
        credentials: this.loadGoogleCredentials(),
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
        projectRoot: this.getProjectRoot(),
        showDeleted:
          (this.context.env.GOOGLE_CALENDAR_SHOW_DELETED || 'false').toLowerCase() === 'true',
      };
      await new GoogleCalendarBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: google-calendar: ${String(error)}`);
      return 'failed';
    }
  }

  private async runGoogleTasksBackup(logger: Logger): Promise<RunStatus> {
    try {
      const config: GoogleTasksBackupConfig = {
        credentials: this.loadGoogleCredentials(),
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
        projectRoot: this.getProjectRoot(),
        showCompleted:
          (this.context.env.GOOGLE_TASKS_SHOW_COMPLETED || 'true').toLowerCase() !== 'false',
        showDeleted:
          (this.context.env.GOOGLE_TASKS_SHOW_DELETED || 'true').toLowerCase() !== 'false',
        showHidden: (this.context.env.GOOGLE_TASKS_SHOW_HIDDEN || 'true').toLowerCase() !== 'false',
      };
      await new GoogleTasksBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: google-tasks: ${String(error)}`);
      return 'failed';
    }
  }

  private async runGoogleContactsBackup(logger: Logger): Promise<RunStatus> {
    try {
      const config: GoogleContactsBackupConfig = {
        credentials: this.loadGoogleCredentials(),
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
        projectRoot: this.getProjectRoot(),
      };
      await new GoogleContactsBackup(this.context).run(config);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: google-contacts: ${String(error)}`);
      return 'failed';
    }
  }

  private loadGoogleCredentials(): GoogleOAuthCredentials {
    return {
      clientId: this.context.env.GOOGLE_CLIENT_ID || '',
      clientSecret: this.context.env.GOOGLE_CLIENT_SECRET || '',
      refreshToken: this.context.env.GOOGLE_REFRESH_TOKEN || '',
    };
  }

  private getLogDir(): string {
    return path.join(this.getProjectRoot(), 'backups', 'logs');
  }

  private getProjectRoot(): string {
    return resolveProjectRoot();
  }
}

async function main(): Promise<void> {
  const { context, projectRoot } = await createBackupContext();

  const config: RunAllConfig = {
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
  };

  await new BackupOrchestrator(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
