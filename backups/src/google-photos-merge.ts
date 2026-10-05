import path from 'node:path';
import { Logger } from './types.js';
import { MediaFs } from './google-photos-media-fs.js';
import { PhotoMeta, PhotosState, StateStore } from './google-photos-state.js';

export interface MergeOptions {
  keepJson: boolean;
  dryRun: boolean;
}

export interface MergeCounts {
  scanned: number;
  copied: number;
  dedupeSkipped: number;
  jsonCopied: number;
  failed: number;
}

const JSON_PATTERN = /\.json$/i;
const SUPPLEMENTAL_PATTERN = /\.supplemental-metadata[^/]*$/i;
const MEDIA_ROOT_SEGMENTS = ['Takeout', 'Google Photos'];

/**
 * Flattens an extracted Takeout tree into the target library, deduplicating
 * by content hash (across runs via the state manifest, and within a run via
 * the same in-memory manifest). Name collisions are resolved with `_1`, `_2`
 * suffixes, mirroring `flatten-photos.sh`.
 */
export class TakeoutMerger {
  constructor(
    private readonly mediaFs: MediaFs,
    private readonly logger: Logger,
    private readonly stateStore: StateStore,
  ) {}

  async merge(
    extractedDir: string,
    targetDir: string,
    state: PhotosState,
    options: MergeOptions,
    runDate: string,
  ): Promise<MergeCounts> {
    const counts: MergeCounts = {
      scanned: 0,
      copied: 0,
      dedupeSkipped: 0,
      jsonCopied: 0,
      failed: 0,
    };
    const mediaRoot = await this.resolveMediaRoot(extractedDir);
    if (!mediaRoot) {
      this.logger.warn(`No Takeout/Google Photos tree found under ${extractedDir}, skipping`);
      return counts;
    }

    const files = await this.mediaFs.readdirRecursive(mediaRoot);
    const mediaFiles = new Set(files.filter((file) => !JSON_PATTERN.test(file)));
    const sidecars = new Map<string, string>();
    for (const file of files) {
      if (!JSON_PATTERN.test(file)) continue;
      const owner = this.findSidecarOwner(file, mediaFiles);
      if (owner) {
        sidecars.set(owner, file);
      }
    }

    for (const relative of [...mediaFiles].sort()) {
      counts.scanned++;
      try {
        await this.mergeOne(
          relative,
          sidecars.get(relative),
          mediaRoot,
          targetDir,
          state,
          options,
          runDate,
          counts,
        );
      } catch (error) {
        counts.failed++;
        this.logger.warn(`Skipping ${relative}: ${String(error)}`);
      }
    }

    return counts;
  }

  private async resolveMediaRoot(extractedDir: string): Promise<string | null> {
    const candidate = path.join(extractedDir, ...MEDIA_ROOT_SEGMENTS);
    if (await this.mediaFs.exists(candidate)) {
      return candidate;
    }
    // Tolerate trees where the Takeout/ prefix is missing.
    const photosOnly = path.join(extractedDir, 'Google Photos');
    if (await this.mediaFs.exists(photosOnly)) {
      return photosOnly;
    }
    return null;
  }

  /**
   * Pairs a JSON sidecar with its media file. Handles both the legacy
   * `IMG_1.jpg.json` and the newer `IMG_1.jpg.supplemental-metadata0.json`
   * Takeout naming.
   */
  private findSidecarOwner(jsonFile: string, mediaFiles: Set<string>): string | null {
    const withoutJson = jsonFile.replace(JSON_PATTERN, '');
    if (mediaFiles.has(withoutJson)) {
      return withoutJson;
    }
    const withoutSupplemental = withoutJson.replace(SUPPLEMENTAL_PATTERN, '');
    if (mediaFiles.has(withoutSupplemental)) {
      return withoutSupplemental;
    }
    return null;
  }

  private async mergeOne(
    relative: string,
    sidecar: string | undefined,
    mediaRoot: string,
    targetDir: string,
    state: PhotosState,
    options: MergeOptions,
    runDate: string,
    counts: MergeCounts,
  ): Promise<void> {
    const sourcePath = path.join(mediaRoot, relative);
    const hash = await this.mediaFs.hashFile(sourcePath);

    if (this.stateStore.has(state, hash)) {
      counts.dedupeSkipped++;
      this.logger.info(`Duplicate content skipped: ${relative}`);
      return;
    }

    const destination = await this.resolveDestination(targetDir, path.basename(relative));
    const size = await this.mediaFs.size(sourcePath);
    const meta = await this.readMeta(mediaRoot, sidecar, relative, path.basename(relative));

    if (options.dryRun) {
      this.logger.info(`[dry-run] copy ${relative} -> ${destination}`);
    } else {
      await this.mediaFs.rename(sourcePath, destination);
    }
    counts.copied++;

    this.stateStore.register(state, hash, {
      path: path.basename(destination),
      size,
      firstSeen: runDate,
      meta,
    });

    if (options.keepJson && sidecar) {
      const sidecarSource = path.join(mediaRoot, sidecar);
      const sidecarDest = `${destination}.json`;
      if (options.dryRun) {
        this.logger.info(`[dry-run] copy ${sidecar} -> ${sidecarDest}`);
      } else {
        await this.mediaFs.copyFile(sidecarSource, sidecarDest);
      }
      counts.jsonCopied++;
    }
  }

  /** Resolves a collision-free destination path using `_1`, `_2` suffixes. */
  private async resolveDestination(targetDir: string, name: string): Promise<string> {
    const candidate = path.join(targetDir, name);
    if (!(await this.mediaFs.exists(candidate))) {
      return candidate;
    }
    const dotIndex = name.lastIndexOf('.');
    const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
    let counter = 1;
    while (await this.mediaFs.exists(path.join(targetDir, `${stem}_${counter}${ext}`))) {
      counter++;
    }
    this.logger.warn(`Name collision: ${name} -> ${stem}_${counter}${ext}`);
    return path.join(targetDir, `${stem}_${counter}${ext}`);
  }

  /** Extracts the useful subset of a Takeout JSON sidecar into PhotoMeta. */
  private async readMeta(
    mediaRoot: string,
    sidecar: string | undefined,
    relative: string,
    fallbackTitle: string,
  ): Promise<PhotoMeta> {
    const album = path.dirname(relative);
    const meta: PhotoMeta = {
      title: fallbackTitle,
      albums: album === '.' ? [] : [album],
    };

    if (!sidecar) {
      return meta;
    }

    try {
      const parsed = JSON.parse(
        await this.mediaFs.readTextFile(path.join(mediaRoot, sidecar)),
      ) as Record<string, unknown>;
      if (typeof parsed.title === 'string' && parsed.title.length > 0) {
        meta.title = parsed.title;
      }
      const creationTime = parsed.creationTime as Record<string, unknown> | undefined;
      const timestamp = Number(creationTime?.timestamp);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        meta.creationTime = new Date(timestamp * 1000).toISOString();
      }
      const mediaData = (parsed.photoData ?? parsed.videoData) as
        | Record<string, unknown>
        | undefined;
      if (typeof mediaData?.cameraMake === 'string') {
        meta.cameraMake = mediaData.cameraMake;
      }
      if (typeof mediaData?.cameraModel === 'string') {
        meta.cameraModel = mediaData.cameraModel;
      }
      if (typeof parsed.description === 'string' && parsed.description.length > 0) {
        meta.description = parsed.description;
      }
    } catch {
      this.logger.warn(`Unreadable metadata sidecar: ${sidecar}`);
    }
    return meta;
  }
}
