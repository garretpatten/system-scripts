import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
import { BackupContext, Logger } from './types.js';
import { formatBackupDate, formatRunTimestamp } from './utils.js';
import { MediaFs, RealMediaFs } from './google-photos-media-fs.js';
import {
  DownloadTransport,
  NodeDownloadTransport,
  TakeoutDownloader,
} from './google-photos-download.js';
import { TakeoutReader } from './google-photos-takeout.js';
import { PhotosState, StateStore } from './google-photos-state.js';
import { MergeCounts, TakeoutMerger } from './google-photos-merge.js';

export type GooglePhotosMode = 'download' | 'merge' | 'full';

export interface GooglePhotosBackupConfig {
  mode: GooglePhotosMode;
  urls: string[];
  slicesDir: string;
  targetDir: string;
  logDir: string;
  keepJson: boolean;
  dryRun: boolean;
}

export class GooglePhotosBackup {
  constructor(
    private readonly context: BackupContext,
    private readonly mediaFs: MediaFs,
    private readonly transport?: DownloadTransport,
  ) {}

  async run(config: GooglePhotosBackupConfig): Promise<void> {
    this.validateConfig(config);

    const runTs = formatRunTimestamp(this.context.dateProvider.now());
    const logFile = path.join(config.logDir, `google-photos-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `google-photos-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    await this.mediaFs.mkdirRecursive(config.slicesDir);
    if (config.dryRun && !(await this.mediaFs.exists(config.targetDir))) {
      this.context.logger.warn(`[dry-run] target directory does not exist: ${config.targetDir}`);
    } else {
      await this.mediaFs.mkdirRecursive(config.targetDir);
    }

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Google Photos Takeout backup');
    logger.info(`Mode: ${config.mode}`);
    logger.info(`Slices directory: ${config.slicesDir}`);
    logger.info(`Target directory: ${config.targetDir}`);
    logger.info(`Log: ${logFile}`);
    if (config.dryRun) {
      logger.warn('Dry run enabled; no files will be changed');
    }

    await this.checkDependencies(logger);

    let failedSlices = 0;
    if (config.mode === 'download' || config.mode === 'full') {
      const downloader = new TakeoutDownloader(
        this.transport ?? new NodeDownloadTransport(),
        this.mediaFs,
        logger,
      );
      const summary = await downloader.downloadAll(config.urls, config.slicesDir);
      failedSlices = summary.failed;
      logger.info(
        `Download summary: ${summary.downloaded} downloaded, ${summary.skipped} skipped, ` +
          `${summary.failed} failed`,
      );
    }

    if (config.mode === 'merge' || config.mode === 'full') {
      const totals = await this.extractAndMerge(config, logger);
      logger.info(
        `Merge summary: ${totals.scanned} scanned, ${totals.copied} new, ` +
          `${totals.dedupeSkipped} duplicates skipped, ${totals.jsonCopied} metadata files, ` +
          `${totals.failed} failed`,
      );
    }

    if (failedSlices > 0) {
      logger.warn(`${failedSlices} slice(s) failed to download. See: ${logFile}`);
      process.exitCode = 1;
    } else {
      logger.success('Google Photos backup completed!');
    }
  }

  private validateConfig(config: GooglePhotosBackupConfig): void {
    const resolvedTarget = path.resolve(config.targetDir);
    if (!config.targetDir || resolvedTarget === path.parse(resolvedTarget).root) {
      throw new Error(
        'Invalid GOOGLE_PHOTOS_TARGET_DIR: must be a non-root directory. ' +
          'Set it in env or .env, or pass --target <dir>',
      );
    }
    if ((config.mode === 'download' || config.mode === 'full') && config.urls.length === 0) {
      throw new Error(
        'No Takeout download URLs provided. Export at takeout.google.com, then pass ' +
          'the download links via --urls <file>, or use --mode merge with archives ' +
          'already placed in the slices directory',
      );
    }
  }

  private async checkDependencies(logger: Logger): Promise<void> {
    logger.info('Checking dependencies...');
    const tar = await this.context.runner.run('tar', ['--version']);
    if (tar.exitCode !== 0) {
      logger.fatal('Missing required dependency: tar');
    }
    const unzip = await this.context.runner.run('unzip', ['-v']);
    if (unzip.exitCode !== 0) {
      logger.fatal('Missing required dependency: unzip');
    }
    logger.success('All dependencies found');
  }

  private async extractAndMerge(
    config: GooglePhotosBackupConfig,
    logger: Logger,
  ): Promise<MergeCounts> {
    await this.checkDiskSpace(config, logger);

    const reader = new TakeoutReader(this.context.runner, this.mediaFs, logger);
    const stateStore = new StateStore(this.mediaFs, config.targetDir);
    const merger = new TakeoutMerger(this.mediaFs, logger, stateStore);

    const state: PhotosState = await stateStore.load();
    const runDate = formatBackupDate(this.context.dateProvider.now());

    const extracted = await reader.extractAll(config.slicesDir);
    if (extracted.length === 0) {
      logger.warn(
        `No Takeout slices extracted from ${config.slicesDir}. ` +
          'Download archives first (--mode download or manual download)',
      );
      return { scanned: 0, copied: 0, dedupeSkipped: 0, jsonCopied: 0, failed: 0 };
    }

    const totals: MergeCounts = {
      scanned: 0,
      copied: 0,
      dedupeSkipped: 0,
      jsonCopied: 0,
      failed: 0,
    };
    for (const slice of extracted) {
      const counts = await merger.merge(
        slice.dir,
        config.targetDir,
        state,
        { keepJson: config.keepJson, dryRun: config.dryRun },
        runDate,
      );
      totals.scanned += counts.scanned;
      totals.copied += counts.copied;
      totals.dedupeSkipped += counts.dedupeSkipped;
      totals.jsonCopied += counts.jsonCopied;
      totals.failed += counts.failed;
    }

    if (!config.dryRun) {
      state.lastRun = new Date().toISOString();
      await stateStore.save(state);
      logger.info(`State manifest: ${stateStore.getPath()}`);
    }
    await reader.cleanupExtracted(config.slicesDir);

    return totals;
  }

  private async checkDiskSpace(config: GooglePhotosBackupConfig, logger: Logger): Promise<void> {
    const reader = new TakeoutReader(this.context.runner, this.mediaFs, logger);
    const slices = await reader.listSlices(config.slicesDir);
    if (slices.length === 0) {
      return;
    }
    const estimate = slices.reduce((sum, slice) => sum + slice.size, 0) * 3;
    const free = await this.mediaFs.freeSpace(config.targetDir);
    if (free !== null && free < estimate) {
      logger.warn(
        `Low disk space: ~${Math.round(estimate / 1e9)} GB recommended for extraction ` +
          `but only ~${Math.round(free / 1e9)} GB free at ${config.targetDir}`,
      );
    }
  }
}

function usage(): void {
  console.log(`Usage: google-photos-backup.sh [OPTIONS]

Downloads and merges a Google Photos Takeout export into a local library.

Options:
  --mode <download|merge|full>  Pipeline stage to run (default: full)
  --urls <file|url,url,...>     Takeout download links: a file with one URL per
                                line, or comma-separated URLs
  --slices <dir>                Archive directory (default: GOOGLE_PHOTOS_SLICES_DIR
                                or ~/Downloads/google-photos-takeout)
  --target <dir>                Library directory (default: GOOGLE_PHOTOS_TARGET_DIR
                                or ~/Pictures/Google Photos)
  --keep-json                   Also copy Takeout .json sidecars into the library
  --dry-run                     Show what would happen without changing files
  -h, --help                    Show this help message`);
}

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv,
  homeDir: string,
): GooglePhotosBackupConfig & { urlsFile?: string } {
  const config: GooglePhotosBackupConfig & { urlsFile?: string } = {
    mode: 'full',
    urls: [],
    slicesDir:
      env.GOOGLE_PHOTOS_SLICES_DIR || path.join(homeDir, 'Downloads', 'google-photos-takeout'),
    targetDir: env.GOOGLE_PHOTOS_TARGET_DIR || path.join(homeDir, 'Pictures', 'Google Photos'),
    logDir: '',
    keepJson: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };
    switch (arg) {
      case '--mode': {
        const mode = next();
        if (mode !== 'download' && mode !== 'merge' && mode !== 'full') {
          throw new Error(`Invalid --mode: ${mode}`);
        }
        config.mode = mode;
        break;
      }
      case '--urls':
        config.urlsFile = next();
        break;
      case '--slices':
        config.slicesDir = next();
        break;
      case '--target':
        config.targetDir = next();
        break;
      case '--keep-json':
        config.keepJson = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return config;
}

async function main(): Promise<void> {
  const fs = new RealFileSystem();
  const mediaFs = new RealMediaFs();
  const runner = new ProcessCommandRunner();
  const http = new NodeHttpClient();
  const archive = new ZipArchive(runner);
  const dateProvider = new SystemDateProvider();
  const logger = new ConsoleLogger();

  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  const projectRoot = path.resolve(srcDir, '..', '..');

  await loadEnvFile(fs, process.env, projectRoot);

  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const config = parseArgs(process.argv.slice(2), process.env, homeDir);

  // --urls points either at a file containing one URL per line, or at
  // inline comma-separated URLs pasted on the command line.
  if (config.urlsFile) {
    if (await mediaFs.exists(config.urlsFile)) {
      config.urls = TakeoutDownloader.parseUrls(await mediaFs.readTextFile(config.urlsFile));
    } else {
      config.urls = TakeoutDownloader.parseUrls(config.urlsFile);
    }
  }

  config.logDir = path.join(projectRoot, 'backups', 'logs');

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

  const backup = new GooglePhotosBackup(context, mediaFs);
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
