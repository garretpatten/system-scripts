import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  copyFile as fsCopyFile,
  mkdir,
  readdir,
  readFile,
  rename as fsRename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * File system abstraction for binary media operations (hashing, renaming,
 * recursive listing). The shared `FileSystem` in types.ts is text-oriented
 * and cannot stream hashes or rename files, so the Google Photos pipeline
 * uses this narrower interface instead.
 */
export interface MediaFs {
  mkdirRecursive(path: string): Promise<void>;
  rmRecursive(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Returns paths of all files under root, relative to root. */
  readdirRecursive(root: string): Promise<string[]>;
  size(path: string): Promise<number>;
  rename(source: string, destination: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  hashFile(path: string): Promise<string>;
  /** Available bytes on the filesystem containing path, or null if unknown. */
  freeSpace(path: string): Promise<number | null>;
}

export class RealMediaFs implements MediaFs {
  async mkdirRecursive(target: string): Promise<void> {
    await mkdir(target, { recursive: true });
  }

  async rmRecursive(target: string): Promise<void> {
    await rm(target, { recursive: true, force: true });
  }

  async exists(target: string): Promise<boolean> {
    return existsSync(target);
  }

  async readdirRecursive(root: string): Promise<string[]> {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
  }

  async size(target: string): Promise<number> {
    const stats = await stat(target);
    return stats.size;
  }

  async rename(source: string, destination: string): Promise<void> {
    try {
      await fsRename(source, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }
      // Cross-device move: copy then remove the source.
      await fsCopyFile(source, destination);
      await unlink(source);
    }
  }

  async copyFile(source: string, destination: string): Promise<void> {
    await fsCopyFile(source, destination);
  }

  async unlink(target: string): Promise<void> {
    await unlink(target);
  }

  async readTextFile(target: string): Promise<string> {
    return readFile(target, 'utf8');
  }

  async writeTextFile(target: string, data: string): Promise<void> {
    await writeFile(target, data, 'utf8');
  }

  async hashFile(target: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(target);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  async freeSpace(target: string): Promise<number | null> {
    try {
      const { statfs } = await import('node:fs/promises');
      const stats = await statfs(target);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  }
}
