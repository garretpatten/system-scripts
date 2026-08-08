import { FileLogger } from './logger.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface ChromiumBookmarksBackupConfig {
  browserName: string;
  sourcePaths: string[];
  outputPrefix: string;
  processPattern: string;
  homeDir: string;
  logDir: string;
  outputDir?: string;
  copyJson?: boolean;
}

interface ChromiumBookmarkNode {
  id?: string;
  name?: string;
  type?: 'url' | 'folder';
  url?: string;
  children?: ChromiumBookmarkNode[];
  date_added?: string;
  date_modified?: string;
  date_last_used?: string;
}

interface ChromiumBookmarks {
  checksum?: string;
  roots?: Record<string, ChromiumBookmarkNode>;
  version?: number;
}

const CHROME_EPOCH_DIFF_MICROSECONDS = 11644473600000000;

export class ChromiumBookmarksBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: ChromiumBookmarksBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const backupDate = formatBackupDate(date);
    const homeDir = config.homeDir;
    const outputDir = config.outputDir ?? homeDir;
    const htmlFile = path.join(outputDir, `${config.outputPrefix}_${backupDate}.html`);
    const jsonFile = path.join(outputDir, `${config.outputPrefix}_${backupDate}.json`);
    const logFile = path.join(config.logDir, `${config.outputPrefix}-backup-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile);

    logger.info(`Starting ${config.browserName} Bookmarks Backup`);
    logger.info(`Output directory: ${outputDir}`);
    logger.info(`Log: ${logFile}`);

    const sourcePath = await this.findBookmarksFile(config.sourcePaths, logger);
    if (!sourcePath) {
      const message = `${config.browserName} bookmarks file not found. Checked default paths.`;
      logger.fatal(message);
      throw new Error(message);
    }

    logger.info(`Source bookmarks file: ${sourcePath}`);

    await this.warnIfBrowserRunning(config.processPattern, config.browserName, logger);

    const rawJson = await this.context.fs.readFile(sourcePath);
    logger.info(`Read ${rawJson.length} bytes from source file`);

    if (config.copyJson ?? true) {
      await this.context.fs.writeFile(jsonFile, rawJson);
      logger.info(`Copied original JSON to: ${jsonFile}`);
    }

    let bookmarks: ChromiumBookmarks;
    try {
      bookmarks = JSON.parse(rawJson) as ChromiumBookmarks;
    } catch (error) {
      const message = `Failed to parse ${config.browserName} bookmarks JSON: ${String(error)}`;
      logger.fatal(message);
      throw new Error(message);
    }

    const html = this.convertToNetscapeHtml(bookmarks);
    await this.context.fs.writeFile(htmlFile, html);
    logger.info(`Wrote Netscape HTML backup: ${htmlFile}`);

    const stats = this.countBookmarks(bookmarks);
    logger.success(`${config.browserName} bookmarks backup completed successfully`);
    logger.info(`Folders: ${stats.folders}, URLs: ${stats.urls}`);
    logger.info(`HTML backup: ${htmlFile}`);
  }

  private async findBookmarksFile(sourcePaths: string[], logger: Logger): Promise<string | null> {
    for (const candidate of sourcePaths) {
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

  private async warnIfBrowserRunning(
    processPattern: string,
    browserName: string,
    logger: Logger,
  ): Promise<void> {
    const result = await this.context.runner.run('pgrep', ['-i', processPattern]);
    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      logger.warn(
        `${browserName} appears to be running. The bookmarks file may be locked or stale.`,
      );
    } else {
      logger.info(`${browserName} does not appear to be running`);
    }
  }

  private convertToNetscapeHtml(bookmarks: ChromiumBookmarks): string {
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
    node: ChromiumBookmarkNode,
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

  private renderNode(lines: string[], node: ChromiumBookmarkNode, depth: number): void {
    if (node.type === 'url') {
      this.renderUrl(lines, node, depth);
    } else if (node.type === 'folder') {
      this.renderFolder(lines, node.name ?? 'Untitled', node, depth);
    }
  }

  private renderUrl(lines: string[], node: ChromiumBookmarkNode, depth: number): void {
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

  private countBookmarks(bookmarks: ChromiumBookmarks): { folders: number; urls: number } {
    let folders = 0;
    let urls = 0;

    const visit = (node: ChromiumBookmarkNode): void => {
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
