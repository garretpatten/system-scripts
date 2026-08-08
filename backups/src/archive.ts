import { Archive, CommandRunner } from './types.js';

export class ZipArchive implements Archive {
  constructor(private readonly runner: CommandRunner) {}

  async zipDirectory(
    sourceDirName: string,
    outputFileName: string,
    cwd: string,
    exclude?: string[]
  ): Promise<void> {
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
