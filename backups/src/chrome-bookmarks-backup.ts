import { createBackupContext } from './backup-context.js';
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
  const { context, projectRoot } = await createBackupContext();

  const config: ChromeBookmarksBackupConfig = {
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
  };

  await new ChromeBookmarksBackup(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
