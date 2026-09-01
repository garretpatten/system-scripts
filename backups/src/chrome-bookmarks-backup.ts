import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ProcessGitRepository, ProcessSyncClient } from './git.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger } from './logger.js';
import { ChromiumBookmarksBackup, ChromiumBookmarksBackupConfig } from './chromium-bookmarks.js';
import { BackupContext } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ChromeBookmarksBackupConfig {
  homeDir: string;
  logDir: string;
  outputDir?: string;
  copyJson?: boolean;
}

const LINUX_BOOKMARKS_PATH = '.config/google-chrome/Default/Bookmarks';
const LINUX_ACCOUNT_BOOKMARKS_PATH = '.config/google-chrome/Default/AccountBookmarks';
const MACOS_BOOKMARKS_PATH = 'Library/Application Support/Google/Chrome/Default/Bookmarks';
const MACOS_ACCOUNT_BOOKMARKS_PATH =
  'Library/Application Support/Google/Chrome/Default/AccountBookmarks';

export class ChromeBookmarksBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: ChromeBookmarksBackupConfig): Promise<void> {
    const chromiumConfig: ChromiumBookmarksBackupConfig = {
      browserName: 'Chrome',
      sourcePaths: [
        path.join(config.homeDir, LINUX_BOOKMARKS_PATH),
        path.join(config.homeDir, LINUX_ACCOUNT_BOOKMARKS_PATH),
        path.join(config.homeDir, MACOS_BOOKMARKS_PATH),
        path.join(config.homeDir, MACOS_ACCOUNT_BOOKMARKS_PATH),
      ],
      outputPrefix: 'chrome-bookmarks',
      processPattern: 'chrome',
      homeDir: config.homeDir,
      logDir: config.logDir,
      outputDir: config.outputDir,
      copyJson: config.copyJson,
    };

    await new ChromiumBookmarksBackup(this.context).run(chromiumConfig);
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

  const config: ChromeBookmarksBackupConfig = {
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

  const backup = new ChromeBookmarksBackup(context);
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
