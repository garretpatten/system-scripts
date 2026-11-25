import path from 'node:path';
import { ZipArchive } from '../../src/archive.js';
import { MockCommandRunner, MockFileSystem } from '../test-helpers.js';

class TrackingFileSystem extends MockFileSystem {
  events: string[] = [];
  rmCalls: Array<{ path: string; options?: { recursive?: boolean; force?: boolean } }> = [];

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.events.push('rm');
    this.rmCalls.push({ path, options });
    await super.rm(path, options);
  }
}

describe('ZipArchive', () => {
  const cwd = '/backups';
  const sourceDirName = 'Notes_2024-06-15';
  const outputFileName = 'Notes_2024-06-15.zip';
  const outputPath = path.join(cwd, outputFileName);

  let runner: MockCommandRunner;
  let fs: TrackingFileSystem;
  let archive: ZipArchive;

  beforeEach(() => {
    runner = new MockCommandRunner();
    fs = new TrackingFileSystem();
    archive = new ZipArchive(runner, fs);
  });

  it('removes an existing zip before running zip -r so deleted files do not persist', async () => {
    fs.files.set(outputPath, 'stale-archive-containing-deleted-file');

    runner.setEffect('zip', ['-r', outputFileName, sourceDirName], () => {
      fs.events.push('zip');
      // zip -r would have updated the existing archive if it were still present.
      expect(fs.files.has(outputPath)).toBe(false);
      fs.files.set(outputPath, 'fresh-archive');
    });

    await archive.zipDirectory(sourceDirName, outputFileName, cwd);

    expect(fs.events).toEqual(['rm', 'zip']);
    expect(fs.rmCalls).toEqual([{ path: outputPath, options: { force: true } }]);
    expect(fs.files.get(outputPath)).toBe('fresh-archive');
    expect(runner.commands).toEqual([
      { command: 'zip', args: ['-r', outputFileName, sourceDirName], options: { cwd } },
    ]);
  });

  it('does not fail when no zip exists at the output path', async () => {
    await archive.zipDirectory(sourceDirName, outputFileName, cwd);

    expect(fs.rmCalls).toEqual([{ path: outputPath, options: { force: true } }]);
    expect(fs.files.has(outputPath)).toBe(false);
    expect(runner.commands).toEqual([
      { command: 'zip', args: ['-r', outputFileName, sourceDirName], options: { cwd } },
    ]);
  });

  it('passes exclude patterns to zip', async () => {
    await archive.zipDirectory(sourceDirName, outputFileName, cwd, ['*.git/*', '*.DS_Store']);

    expect(runner.commands).toEqual([
      {
        command: 'zip',
        args: ['-r', outputFileName, sourceDirName, '-x', '*.git/*', '-x', '*.DS_Store'],
        options: { cwd },
      },
    ]);
  });

  it('throws when zip exits non-zero', async () => {
    runner.setResponse('zip', ['-r', outputFileName, sourceDirName], {
      stdout: '',
      stderr: 'zip error: Nothing to do',
      exitCode: 12,
    });

    await expect(archive.zipDirectory(sourceDirName, outputFileName, cwd)).rejects.toThrow(
      'zip failed: zip error: Nothing to do',
    );
  });
});
