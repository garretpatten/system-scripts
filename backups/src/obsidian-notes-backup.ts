import { createBackupContext } from './backup-context.js';
import { checkDependencies } from './dependencies.js';
import { storeArchive } from './export-dir.js';
import { FileLogger } from './logger.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface ObsidianNotesBackupConfig {
  homeDir: string;
  logDir: string;
  sourceDir?: string;
}

const DEFAULT_SOURCE_DIR = 'Notes';

interface FileEntry {
  sourcePath: string;
  relativePath: string;
}

export class ObsidianNotesBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: ObsidianNotesBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const backupDate = formatBackupDate(date);
    const backupDirName = `Obsidian-Notes_${backupDate}`;
    const sourceDir = config.sourceDir || path.join(config.homeDir, DEFAULT_SOURCE_DIR);
    const backupDir = path.join(config.homeDir, backupDirName);
    const backupZip = path.join(config.homeDir, `${backupDirName}.zip`);
    const logFile = path.join(config.logDir, `obsidian-notes-backup-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    const logger = new FileLogger(this.context.logger, this.context.fs, logFile);

    logger.info('Starting Obsidian Notes backup');
    logger.info(`Source directory: ${sourceDir}`);
    logger.info(`Backup directory: ${backupDir}`);
    logger.info(`Log: ${logFile}`);

    if (!(await this.context.fs.exists(sourceDir))) {
      logger.warn(`Obsidian notes directory not found: ${sourceDir}`);
      return;
    }

    await checkDependencies(this.context.runner, ['zip'], logger);

    if (await this.context.fs.exists(backupDir)) {
      await this.context.fs.rm(backupDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(backupDir, { recursive: true });

    const fileCount = await this.copyNotes(sourceDir, backupDir);

    await this.createBackup(backupDirName, config.homeDir, logger);

    const archivePath = await storeArchive(
      this.context.fs,
      this.context.env,
      logger,
      backupZip,
      config.homeDir,
      date,
    );

    logger.success('Obsidian Notes backup completed!');
    logger.info(`Notes backed up: ${fileCount}`);
    logger.info(`Archive: ${archivePath}`);

    await this.context.fs.rm(backupDir, { recursive: true, force: true });
  }

  private async copyNotes(sourceDir: string, backupDir: string): Promise<number> {
    let count = 0;
    const entries = await this.walkDirectory(sourceDir);

    for (const entry of entries) {
      const destDir = path.join(backupDir, path.dirname(entry.relativePath));
      await this.context.fs.mkdir(destDir, { recursive: true });

      // Byte-preserving copy: reading and writing as utf8 text would
      // silently corrupt binary attachments (PNGs, PDFs, Excalidraw).
      await this.context.fs.copyFile(entry.sourcePath, path.join(backupDir, entry.relativePath));
      count++;
    }

    return count;
  }

  private async walkDirectory(dir: string, relativePrefix = ''): Promise<FileEntry[]> {
    const results: FileEntry[] = [];
    const entries = await this.context.fs.readdir(dir);
    for (const entry of entries) {
      const sourcePath = path.join(dir, entry);
      const relativePath = relativePrefix ? `${relativePrefix}/${entry}` : entry;
      const stats = await this.context.fs.stat(sourcePath);
      if (stats.isDirectory()) {
        results.push(...(await this.walkDirectory(sourcePath, relativePath)));
      } else {
        results.push({ sourcePath, relativePath });
      }
    }
    return results;
  }

  private async createBackup(backupDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating Obsidian Notes backup zip...');
    const outputFileName = `${backupDirName}.zip`;
    await this.context.archive.zipDirectory(backupDirName, outputFileName, cwd);
    logger.success(`Backup created successfully: ${path.join(cwd, outputFileName)}`);
  }
}

async function main(): Promise<void> {
  const { context, projectRoot } = await createBackupContext();

  const config: ObsidianNotesBackupConfig = {
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
  };

  await new ObsidianNotesBackup(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
