import path from 'node:path';
import { CommandRunner, Logger } from './types.js';
import { MediaFs } from './google-photos-media-fs.js';

export interface SliceInfo {
  name: string;
  path: string;
  size: number;
}

export interface ExtractedSlice {
  slice: SliceInfo;
  dir: string;
  entries: number;
}

const ARCHIVE_PATTERN = /\.(zip|tgz|tar\.gz)$/i;
export const EXTRACTED_DIR_NAME = '_extracted';

/**
 * Inventories and extracts Google Takeout archive slices via the system
 * `tar`/`unzip` binaries (mirroring how `ZipArchive` wraps `zip`).
 */
export class TakeoutReader {
  constructor(
    private readonly runner: CommandRunner,
    private readonly mediaFs: MediaFs,
    private readonly logger: Logger,
  ) {}

  /** Lists top-level archive slices in a directory, sorted by name. */
  async listSlices(slicesDir: string): Promise<SliceInfo[]> {
    if (!(await this.mediaFs.exists(slicesDir))) {
      return [];
    }
    const files = await this.mediaFs.readdirRecursive(slicesDir);
    const slices: SliceInfo[] = [];
    for (const relative of files) {
      if (relative.includes(path.sep) || relative.startsWith(EXTRACTED_DIR_NAME)) {
        continue;
      }
      if (!ARCHIVE_PATTERN.test(relative)) {
        continue;
      }
      const fullPath = path.join(slicesDir, relative);
      slices.push({ name: relative, path: fullPath, size: await this.mediaFs.size(fullPath) });
    }
    return slices.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listArchiveEntries(slicePath: string): Promise<string[]> {
    const isZip = /\.zip$/i.test(slicePath);
    const command = isZip ? 'unzip' : 'tar';
    const args = isZip ? ['-Z1', slicePath] : ['-tzf', slicePath];
    const result = await this.runner.run(command, args);
    if (result.exitCode !== 0) {
      throw new Error(`${command} failed to list ${path.basename(slicePath)}: ${result.stderr}`);
    }
    return result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }

  /**
   * Extracts one slice into a per-slice directory under workDir.
   * Returns the extraction directory and the number of archive entries.
   */
  async extractSlice(slice: SliceInfo, workDir: string): Promise<ExtractedSlice> {
    const destDir = path.join(workDir, slice.name.replace(ARCHIVE_PATTERN, ''));
    await this.mediaFs.rmRecursive(destDir);
    await this.mediaFs.mkdirRecursive(destDir);

    this.logger.info(`Slice ${slice.name}: inventorying archive`);
    const entries = await this.listArchiveEntries(slice.path);
    this.logger.info(`Slice ${slice.name}: ${entries.length} entries, extracting`);

    const isZip = /\.zip$/i.test(slice.name);
    const command = isZip ? 'unzip' : 'tar';
    const args = isZip ? ['-q', slice.path, '-d', destDir] : ['-xzf', slice.path, '-C', destDir];
    const result = await this.runner.run(command, args);
    if (result.exitCode !== 0) {
      throw new Error(`${command} failed to extract ${slice.name}: ${result.stderr}`);
    }

    this.logger.success(`Slice ${slice.name}: extracted to ${destDir}`);
    return { slice, dir: destDir, entries: entries.length };
  }

  /**
   * Extracts every slice found in slicesDir. A failing slice is logged and
   * skipped so the remaining slices still merge.
   */
  async extractAll(slicesDir: string): Promise<ExtractedSlice[]> {
    const slices = await this.listSlices(slicesDir);
    const workDir = path.join(slicesDir, EXTRACTED_DIR_NAME);
    await this.mediaFs.mkdirRecursive(workDir);

    const extracted: ExtractedSlice[] = [];
    for (const slice of slices) {
      try {
        extracted.push(await this.extractSlice(slice, workDir));
      } catch (error) {
        this.logger.warn(`Slice ${slice.name}: extraction skipped: ${String(error)}`);
      }
    }
    return extracted;
  }

  async cleanupExtracted(slicesDir: string): Promise<void> {
    await this.mediaFs.rmRecursive(path.join(slicesDir, EXTRACTED_DIR_NAME));
  }
}
