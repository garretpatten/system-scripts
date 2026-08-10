import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ProcessGitRepository, ProcessSyncClient } from './git.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
import { LocalBackup, LocalBackupConfig } from './local-backup.js';
import { GitLabMirror, GitLabMirrorConfig } from './gitlab-mirror.js';
import { TodoistBackup, TodoistBackupConfig } from './todoist-backup.js';
import { NotionBackup, NotionBackupConfig } from './notion-backup.js';
import { BraveBookmarksBackup, BraveBookmarksBackupConfig } from './brave-bookmarks-backup.js';
import { ChromeBookmarksBackup, ChromeBookmarksBackupConfig } from './chrome-bookmarks-backup.js';
import { StandardNotesBackup, StandardNotesBackupConfig } from './standard-notes-backup.js';
import { GoogleCalendarBackup, GoogleCalendarBackupConfig } from './google-calendar-backup.js';
import { GoogleTasksBackup, GoogleTasksBackupConfig } from './google-tasks-backup.js';
import { GoogleOAuthCredentials } from './google-auth.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRunTimestamp } from './utils.js';

interface RunAllConfig {
  homeDir: string;
  logDir: string;
}

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

    const results: Record<string, boolean> = {};

    results['code-local'] = await this.runLocalBackup(logger);
    results['code-gitlab'] = await this.runGitlabMirror(logger);
    results['todoist'] = await this.runTodoistBackup(logger);
    results['notion'] = await this.runNotionBackup(logger);
    results['brave-bookmarks'] = await this.runBraveBookmarksBackup(logger);
    results['chrome-bookmarks'] = await this.runChromeBookmarksBackup(logger);
    results['standard-notes'] = await this.runStandardNotesBackup(logger);
    results['google-calendar'] = await this.runGoogleCalendarBackup(logger);
    results['google-tasks'] = await this.runGoogleTasksBackup(logger);

    logger.info('Backup summary:');
    for (const [name, ok] of Object.entries(results)) {
      logger.info(`  ${name.padEnd(17)}: ${ok ? 'OK' : 'FAILED'}`);
    }

    if (Object.values(results).some((ok) => !ok)) {
      logger.warn(`One or more backups failed. See: ${logFile}`);
      process.exitCode = 1;
    } else {
      logger.success('All backups completed successfully');
    }
  }

  private async runLocalBackup(logger: Logger): Promise<boolean> {
    try {
      const config: LocalBackupConfig = {
        githubToken: this.context.env.GITHUB_TOKEN || undefined,
        githubUsername: this.context.env.GITHUB_USERNAME || undefined,
        useSsh: (this.context.env.USE_GITHUB_SSH || 'false').toLowerCase() === 'true',
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new LocalBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: code-local: ${String(error)}`);
      return false;
    }
  }

  private async runGitlabMirror(logger: Logger): Promise<boolean> {
    try {
      const config: GitLabMirrorConfig = {
        githubToken: this.context.env.GITHUB_TOKEN || undefined,
        githubUsername: this.context.env.GITHUB_USERNAME || undefined,
        useSsh: (this.context.env.USE_GITHUB_SSH || 'false').toLowerCase() === 'true',
        gitlabToken: this.context.env.GITLAB_TOKEN || '',
        gitlabNamespace: this.context.env.GITLAB_NAMESPACE || '',
        autoCreateProjects:
          (this.context.env.AUTO_CREATE_GITLAB_PROJECTS || 'true').toLowerCase() === 'true',
        gitlabVisibility: this.context.env.GITLAB_VISIBILITY || 'private',
        gitlabHost: this.context.env.GITLAB_HOST || 'https://gitlab.com',
        backupRoot:
          this.context.env.BACKUP_ROOT ||
          path.join(this.context.env.HOME || '.', 'GitHub-GitLab-Backup'),
      };
      await new GitLabMirror(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: code-gitlab: ${String(error)}`);
      return false;
    }
  }

  private async runTodoistBackup(logger: Logger): Promise<boolean> {
    try {
      const config: TodoistBackupConfig = {
        apiToken: this.context.env.TODOIST_API_TOKEN || '',
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new TodoistBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: todoist: ${String(error)}`);
      return false;
    }
  }

  private async runNotionBackup(logger: Logger): Promise<boolean> {
    try {
      const config: NotionBackupConfig = {
        apiToken: this.context.env.NOTION_API_TOKEN || '',
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
        rateLimitDelayMs: parseFloat(this.context.env.NOTION_RATE_LIMIT_DELAY || '0.35') * 1000,
      };
      await new NotionBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: notion: ${String(error)}`);
      return false;
    }
  }

  private async runBraveBookmarksBackup(logger: Logger): Promise<boolean> {
    try {
      const config: BraveBookmarksBackupConfig = {
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new BraveBookmarksBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: brave-bookmarks: ${String(error)}`);
      return false;
    }
  }

  private async runChromeBookmarksBackup(logger: Logger): Promise<boolean> {
    try {
      const config: ChromeBookmarksBackupConfig = {
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new ChromeBookmarksBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: chrome-bookmarks: ${String(error)}`);
      return false;
    }
  }

  private async runStandardNotesBackup(logger: Logger): Promise<boolean> {
    try {
      const config: StandardNotesBackupConfig = {
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
      };
      await new StandardNotesBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: standard-notes: ${String(error)}`);
      return false;
    }
  }

  private async runGoogleCalendarBackup(logger: Logger): Promise<boolean> {
    try {
      const config: GoogleCalendarBackupConfig = {
        credentials: this.loadGoogleCredentials(),
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
        showDeleted:
          (this.context.env.GOOGLE_CALENDAR_SHOW_DELETED || 'false').toLowerCase() === 'true',
      };
      await new GoogleCalendarBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: google-calendar: ${String(error)}`);
      return false;
    }
  }

  private async runGoogleTasksBackup(logger: Logger): Promise<boolean> {
    try {
      const config: GoogleTasksBackupConfig = {
        credentials: this.loadGoogleCredentials(),
        homeDir: this.context.env.HOME || this.context.env.USERPROFILE || '.',
        logDir: this.getLogDir(),
        showCompleted:
          (this.context.env.GOOGLE_TASKS_SHOW_COMPLETED || 'true').toLowerCase() !== 'false',
        showDeleted:
          (this.context.env.GOOGLE_TASKS_SHOW_DELETED || 'true').toLowerCase() !== 'false',
        showHidden: (this.context.env.GOOGLE_TASKS_SHOW_HIDDEN || 'true').toLowerCase() !== 'false',
      };
      await new GoogleTasksBackup(this.context).run(config);
      return true;
    } catch (error) {
      logger.warn(`Backup failed or had errors: google-tasks: ${String(error)}`);
      return false;
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
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = path.dirname(currentFile);
    const projectRoot = path.resolve(srcDir, '..', '..');
    return path.join(projectRoot, 'backups', 'logs');
  }
}

async function main(): Promise<void> {
  const fs = new RealFileSystem();
  const runner = new ProcessCommandRunner();
  const http = new NodeHttpClient();
  const git = new ProcessGitRepository(runner);
  const sync = new ProcessSyncClient(runner);
  const archive = new ZipArchive(runner);
  const dateProvider = new SystemDateProvider();
  const logger = new ConsoleLogger();

  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  const projectRoot = path.resolve(srcDir, '..', '..');

  await loadEnvFile(fs, process.env, projectRoot);

  const config: RunAllConfig = {
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
  };

  const context: BackupContext = {
    logger,
    fs,
    http,
    git,
    sync,
    archive,
    dateProvider,
    env: process.env,
    runner,
  };

  const orchestrator = new BackupOrchestrator(context);
  await orchestrator.run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
