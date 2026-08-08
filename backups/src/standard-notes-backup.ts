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

export interface StandardNotesBackupConfig {
  homeDir: string;
  logDir: string;
  sourceDir?: string;
}

const DEFAULT_SOURCE_DIR = 'garret.patten@proton.me/Plaintext Backups';

interface FileEntry {
  sourcePath: string;
  relativePath: string;
}

export class StandardNotesBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: StandardNotesBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const backupDate = formatBackupDate(date);
    const backupDirName = `Standard-Notes_${backupDate}`;
    const sourceDir = config.sourceDir || path.join(config.homeDir, DEFAULT_SOURCE_DIR);
    const backupDir = path.join(config.homeDir, backupDirName);
    const backupZip = path.join(config.homeDir, `${backupDirName}.zip`);
    const logFile = path.join(config.logDir, `standard-notes-backup-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    const logger = new FileLogger(this.context.logger, this.context.fs, logFile);

    logger.info('Starting Standard Notes backup');
    logger.info(`Source directory: ${sourceDir}`);
    logger.info(`Backup directory: ${backupDir}`);
    logger.info(`Log: ${logFile}`);

    if (!(await this.context.fs.exists(sourceDir))) {
      logger.warn(
        'Plaintext Backups must be enabled for Standard Notes and set to the home directory.',
      );
      return;
    }

    await this.checkDependencies(logger);

    if (await this.context.fs.exists(backupDir)) {
      await this.context.fs.rm(backupDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(backupDir, { recursive: true });

    const fileCount = await this.copyNotes(sourceDir, backupDir);

    await this.createBackup(backupDirName, config.homeDir, logger);

    logger.success('Standard Notes backup completed!');
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
      const relativeDir = path.dirname(entry.relativePath);
      const cleanedDirName = this.cleanDirectoryName(relativeDir);
      const destDir = path.join(backupDir, cleanedDirName);
      await this.context.fs.mkdir(destDir, { recursive: true });

      const cleanedName = this.cleanNoteName(path.basename(entry.sourcePath));
      const destPath = await this.uniqueFilePath(destDir, cleanedName);

      const content = await this.context.fs.readFile(entry.sourcePath);
      await this.context.fs.writeFile(destPath, content);
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

  private cleanDirectoryName(relativeDir: string): string {
    if (relativeDir === '.' || relativeDir === '') {
      return '';
    }
    return relativeDir
      .split(path.sep)
      .map((part) => this.cleanName(part))
      .join(path.sep);
  }

  private cleanNoteName(filename: string): string {
    const base = filename.replace(/-[a-fA-F0-9]+_txt$/, '');
    const cleaned = this.cleanName(base);
    return `${cleaned}.md`;
  }

  private cleanName(name: string): string {
    const cleaned = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return cleaned.length > 0 ? cleaned : 'untitled';
  }

  private async uniqueFilePath(dir: string, filename: string): Promise<string> {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const candidate = path.join(dir, `${base}${ext}`);
    if (!(await this.context.fs.exists(candidate))) {
      return candidate;
    }
    let counter = 1;
    while (await this.context.fs.exists(path.join(dir, `${base}_${counter}${ext}`))) {
      counter++;
    }
    return path.join(dir, `${base}_${counter}${ext}`);
  }

  private async createBackup(backupDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating Standard Notes backup zip...');
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

  const config: StandardNotesBackupConfig = {
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

  const backup = new StandardNotesBackup(context);
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
