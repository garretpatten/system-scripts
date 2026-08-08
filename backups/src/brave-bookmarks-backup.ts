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

export interface BraveBookmarksBackupConfig {
  homeDir: string;
  logDir: string;
  outputDir?: string;
  copyJson?: boolean;
}

interface BraveBookmarkNode {
  id?: string;
  name?: string;
  type?: 'url' | 'folder';
  url?: string;
  children?: BraveBookmarkNode[];
  date_added?: string;
  date_modified?: string;
  date_last_used?: string;
}

interface BraveBookmarks {
  checksum?: string;
  roots?: Record<string, BraveBookmarkNode>;
  version?: number;
}

const LINUX_BOOKMARKS_PATH = '.config/BraveSoftware/Brave-Browser/Default/Bookmarks';
const MACOS_BOOKMARKS_PATH =
  'Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks';
const CHROME_EPOCH_DIFF_MICROSECONDS = 11644473600000000;

export class BraveBookmarksBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: BraveBookmarksBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const backupDate = formatBackupDate(date);
    const homeDir = config.homeDir;
    const outputDir = config.outputDir ?? homeDir;
    const htmlFile = path.join(outputDir, `brave-bookmarks_${backupDate}.html`);
    const jsonFile = path.join(outputDir, `brave-bookmarks_${backupDate}.json`);
    const logFile = path.join(config.logDir, `brave-bookmarks-backup-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile);

    logger.info('Starting Brave Bookmarks Backup');
    logger.info(`Output directory: ${outputDir}`);
    logger.info(`Log: ${logFile}`);

    const sourcePath = await this.findBookmarksFile(homeDir, logger);
    if (!sourcePath) {
      const message = 'Brave bookmarks file not found. Checked Linux and macOS default paths.';
      logger.fatal(message);
      throw new Error(message);
    }

    logger.info(`Source bookmarks file: ${sourcePath}`);

    await this.warnIfBraveRunning(logger);

    const rawJson = await this.context.fs.readFile(sourcePath);
    logger.info(`Read ${rawJson.length} bytes from source file`);

    if (config.copyJson ?? true) {
      await this.context.fs.writeFile(jsonFile, rawJson);
      logger.info(`Copied original JSON to: ${jsonFile}`);
    }

    let bookmarks: BraveBookmarks;
    try {
      bookmarks = JSON.parse(rawJson) as BraveBookmarks;
    } catch (error) {
      const message = `Failed to parse Brave bookmarks JSON: ${String(error)}`;
      logger.fatal(message);
      throw new Error(message);
    }

    const html = this.convertToNetscapeHtml(bookmarks);
    await this.context.fs.writeFile(htmlFile, html);
    logger.info(`Wrote Netscape HTML backup: ${htmlFile}`);

    const stats = this.countBookmarks(bookmarks);
    logger.success('Brave bookmarks backup completed successfully');
    logger.info(`Folders: ${stats.folders}, URLs: ${stats.urls}`);
    logger.info(`HTML backup: ${htmlFile}`);
  }

  private async findBookmarksFile(homeDir: string, logger: Logger): Promise<string | null> {
    const candidates = [
      path.join(homeDir, LINUX_BOOKMARKS_PATH),
      path.join(homeDir, MACOS_BOOKMARKS_PATH),
    ];

    for (const candidate of candidates) {
      if (await this.context.fs.exists(candidate)) {
        try {
          await this.context.fs.readFile(candidate);
          logger.info(`Using bookmarks file: ${candidate}`);
          return candidate;
        } catch {
          logger.warn(`Found bookmarks file but cannot read: ${candidate}`);
        }
      }
    }

    return null;
  }

  private async warnIfBraveRunning(logger: Logger): Promise<void> {
    const result = await this.context.runner.run('pgrep', ['-i', 'brave']);
    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      logger.warn('Brave appears to be running. The bookmarks file may be locked or stale.');
    } else {
      logger.info('Brave does not appear to be running');
    }
  }

  private convertToNetscapeHtml(bookmarks: BraveBookmarks): string {
    const lines: string[] = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- This is an automatically generated file.',
      '     It will be read and overwritten.',
      '     DO NOT EDIT! -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>Bookmarks</TITLE>',
      '<H1>Bookmarks</H1>',
      '<DL><p>',
    ];

    if (bookmarks.roots) {
      for (const [rootName, rootNode] of Object.entries(bookmarks.roots)) {
        if (rootNode?.children && rootNode.children.length > 0) {
          const title = rootNode.name ?? this.formatRootName(rootName);
          this.renderFolder(lines, title, rootNode, 1);
        }
      }
    }

    lines.push('</DL><p>');
    lines.push('');
    return lines.join('\n');
  }

  private formatRootName(name: string): string {
    switch (name) {
      case 'bookmark_bar':
        return 'Bookmarks Bar';
      case 'other':
        return 'Other Bookmarks';
      case 'synced':
        return 'Mobile Bookmarks';
      default:
        return name;
    }
  }

  private renderFolder(
    lines: string[],
    title: string,
    node: BraveBookmarkNode,
    depth: number,
  ): void {
    const indent = '  '.repeat(depth);
    const addDate = this.formatDate(node.date_added);
    const lastModified = this.formatDate(node.date_modified);
    lines.push(
      `${indent}<DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${lastModified}">${escapeHtml(title)}</H3>`,
    );
    lines.push(`${indent}<DL><p>`);
    if (node.children) {
      for (const child of node.children) {
        this.renderNode(lines, child, depth + 1);
      }
    }
    lines.push(`${indent}</DL><p>`);
  }

  private renderNode(lines: string[], node: BraveBookmarkNode, depth: number): void {
    if (node.type === 'url') {
      this.renderUrl(lines, node, depth);
    } else if (node.type === 'folder') {
      this.renderFolder(lines, node.name ?? 'Untitled', node, depth);
    }
  }

  private renderUrl(lines: string[], node: BraveBookmarkNode, depth: number): void {
    const indent = '  '.repeat(depth);
    const addDate = this.formatDate(node.date_added);
    const lastModified = this.formatDate(node.date_modified);
    const url = node.url ?? '';
    const name = node.name ?? url;
    lines.push(
      `${indent}<DT><A HREF="${escapeHtml(url)}" ADD_DATE="${addDate}" LAST_MODIFIED="${lastModified}">${escapeHtml(name)}</A>`,
    );
  }

  private formatDate(chromeTime: string | undefined): string {
    if (!chromeTime) return '0';
    const microseconds = Number(chromeTime);
    if (!Number.isFinite(microseconds)) return '0';
    const unixSeconds = Math.floor((microseconds - CHROME_EPOCH_DIFF_MICROSECONDS) / 1000000);
    return String(Math.max(0, unixSeconds));
  }

  private countBookmarks(bookmarks: BraveBookmarks): { folders: number; urls: number } {
    let folders = 0;
    let urls = 0;

    const visit = (node: BraveBookmarkNode): void => {
      if (node.type === 'folder') {
        folders++;
      } else if (node.type === 'url') {
        urls++;
      }
      if (node.children) {
        for (const child of node.children) {
          visit(child);
        }
      }
    };

    if (bookmarks.roots) {
      for (const root of Object.values(bookmarks.roots)) {
        if (root) visit(root);
      }
    }

    return { folders, urls };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  const config: BraveBookmarksBackupConfig = {
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

  const backup = new BraveBookmarksBackup(context);
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
