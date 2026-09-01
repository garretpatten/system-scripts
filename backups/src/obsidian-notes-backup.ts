import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ProcessGitRepository, ProcessSyncClient } from './git.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
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

    await this.checkDependencies(logger);

    if (await this.context.fs.exists(backupDir)) {
      await this.context.fs.rm(backupDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(backupDir, { recursive: true });

    const fileCount = await this.copyNotes(sourceDir, backupDir);

    await this.createBackup(backupDirName, config.homeDir, logger);

    logger.success('Obsidian Notes backup completed!');
    logger.info(`Notes backed up: ${fileCount}`);
    logger.info(`Archive: ${backupZip}`);

    await this.context.fs.rm(backupDir, { recursive: true, force: true });
  }

  private async checkDependencies(logger: Logger): Promise<void> {
    logger.info('Checking dependencies...');
    const result = await this.context.runner.run('zip', ['--version']);
    if (result.exitCode !== 0) {
      logger.fatal('Missing required dependency: zip');
    }
    logger.success('All dependencies found');
  }

  private async copyNotes(sourceDir: string, backupDir: string): Promise<number> {
    let count = 0;
    const entries = await this.walkDirectory(sourceDir);

    for (const entry of entries) {
      const destDir = path.join(backupDir, path.dirname(entry.relativePath));
      await this.context.fs.mkdir(destDir, { recursive: true });

      const content = await this.context.fs.readFile(entry.sourcePath);
      await this.context.fs.writeFile(path.join(backupDir, entry.relativePath), content);
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

  const config: ObsidianNotesBackupConfig = {
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

  const backup = new ObsidianNotesBackup(context);
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
