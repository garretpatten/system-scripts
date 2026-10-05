import path from 'node:path';
import { MediaFs } from './google-photos-media-fs.js';

export const STATE_VERSION = 1;
export const STATE_FILE_NAME = '.google-photos-state.json';

export interface PhotoMeta {
  title?: string;
  creationTime?: string;
  cameraMake?: string;
  cameraModel?: string;
  description?: string;
  albums?: string[];
}

export interface StateItem {
  path: string;
  size: number;
  firstSeen: string;
  meta: PhotoMeta;
}

export interface PhotosState {
  version: number;
  lastRun: string;
  items: Record<string, StateItem>;
}

/**
 * Hash-keyed manifest persisted in the target directory. It makes repeat
 * exports incremental: any content hash already present is never copied
 * twice, so a fresh Takeout only merges genuinely new media.
 */
export class StateStore {
  private readonly statePath: string;

  constructor(
    private readonly mediaFs: MediaFs,
    targetDir: string,
  ) {
    this.statePath = path.join(targetDir, STATE_FILE_NAME);
  }

  getPath(): string {
    return this.statePath;
  }

  static empty(): PhotosState {
    return { version: STATE_VERSION, lastRun: '', items: {} };
  }

  has(state: PhotosState, hash: string): boolean {
    return hash in state.items;
  }

  register(state: PhotosState, hash: string, item: StateItem): void {
    state.items[hash] = item;
  }

  /**
   * Loads the manifest. A missing, corrupt, or stale-version file is treated
   * as empty: the merge simply re-hashes everything, which is always safe.
   */
  async load(): Promise<PhotosState> {
    if (!(await this.mediaFs.exists(this.statePath))) {
      return StateStore.empty();
    }
    try {
      const parsed = JSON.parse(await this.mediaFs.readTextFile(this.statePath)) as PhotosState;
      if (parsed.version !== STATE_VERSION || typeof parsed.items !== 'object') {
        return StateStore.empty();
      }
      return parsed;
    } catch {
      return StateStore.empty();
    }
  }

  /** Writes the manifest atomically (`.tmp` file + rename). */
  async save(state: PhotosState): Promise<void> {
    const tmpPath = `${this.statePath}.tmp`;
    await this.mediaFs.writeTextFile(tmpPath, JSON.stringify(state, null, 2));
    await this.mediaFs.rename(tmpPath, this.statePath);
  }
}
