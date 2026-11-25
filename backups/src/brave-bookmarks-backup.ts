import { createBackupContext } from './backup-context.js';
import { ChromiumBookmarksBackup, ChromiumBookmarksBackupConfig } from './chromium-bookmarks.js';
import { BackupContext } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BraveBookmarksBackupConfig {
  homeDir: string;
  logDir: string;
  outputDir?: string;
  copyJson?: boolean;
}

const LINUX_BOOKMARKS_PATH = '.config/BraveSoftware/Brave-Browser/Default/Bookmarks';
const MACOS_BOOKMARKS_PATH =
  'Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks';

export class BraveBookmarksBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: BraveBookmarksBackupConfig): Promise<void> {
    const chromiumConfig: ChromiumBookmarksBackupConfig = {
      browserName: 'Brave',
      sourcePaths: [
        path.join(config.homeDir, LINUX_BOOKMARKS_PATH),
        path.join(config.homeDir, MACOS_BOOKMARKS_PATH),
      ],
      outputPrefix: 'brave-bookmarks',
      processPattern: 'brave',
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

  const config: BraveBookmarksBackupConfig = {
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
  };

  await new BraveBookmarksBackup(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
