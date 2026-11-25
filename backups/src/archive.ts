import path from 'node:path';
import { RealFileSystem } from './fs.js';
import { Archive, CommandRunner, FileSystem } from './types.js';

export class ZipArchive implements Archive {
  constructor(
    private readonly runner: CommandRunner,
    private readonly fs: FileSystem = new RealFileSystem(),
  ) {}

  async zipDirectory(
    sourceDirName: string,
    outputFileName: string,
    cwd: string,
    exclude?: string[],
  ): Promise<void> {
    // zip -r updates an existing archive, so same-day re-runs would keep
    // entries for files deleted since the last run. Remove any previous zip first.
    await this.fs.rm(path.join(cwd, outputFileName), { force: true });

    const args = ['-r', outputFileName, sourceDirName];
    if (exclude && exclude.length > 0) {
      for (const pattern of exclude) {
        args.push('-x', pattern);
      }
    }

    const result = await this.runner.run('zip', args, { cwd });

    if (result.exitCode !== 0) {
      throw new Error(`zip failed: ${result.stderr}`);
    }
  }
}
