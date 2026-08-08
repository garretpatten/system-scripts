import { mkdir, rm, writeFile, appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { FileSystem } from './types.js';

export class RealFileSystem implements FileSystem {
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, { recursive: options?.recursive ?? false });
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await rm(path, { recursive: options?.recursive ?? false, force: options?.force ?? false });
  }

  async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data, 'utf8');
  }

  async appendFile(path: string, data: string): Promise<void> {
    await appendFile(path, data, 'utf8');
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  async readdir(path: string): Promise<string[]> {
    return readdir(path);
  }

  async stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }> {
    return stat(path);
  }
}
