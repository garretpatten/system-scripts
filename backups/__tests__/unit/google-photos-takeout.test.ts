import { TakeoutReader } from '../../src/google-photos-takeout.js';
import { MockCommandRunner, MockLogger, MockMediaFs } from '../test-helpers.js';

describe('TakeoutReader', () => {
  let mediaFs: MockMediaFs;
  let runner: MockCommandRunner;
  let logger: MockLogger;
  let reader: TakeoutReader;

  beforeEach(() => {
    mediaFs = new MockMediaFs();
    runner = new MockCommandRunner();
    logger = new MockLogger();
    reader = new TakeoutReader(runner, mediaFs, logger);
  });

  describe('listSlices', () => {
    it('lists top-level archive slices sorted by name', async () => {
      mediaFs.seedFile('/slices/takeout-002.tgz', 'b');
      mediaFs.seedFile('/slices/takeout-001.zip', 'a');
      mediaFs.seedFile('/slices/notes.txt', 'not an archive');
      mediaFs.seedFile('/slices/nested/takeout-003.zip', 'nested');
      mediaFs.seedFile('/slices/_extracted/takeout-001/file.jpg', 'extracted');

      const slices = await reader.listSlices('/slices');

      expect(slices.map((s) => s.name)).toEqual(['takeout-001.zip', 'takeout-002.tgz']);
      expect(slices[0].size).toBe(1);
    });

    it('returns an empty list when the directory is missing', async () => {
      expect(await reader.listSlices('/missing')).toEqual([]);
    });
  });

  describe('listArchiveEntries', () => {
    it('lists zip entries via unzip -Z1', async () => {
      mediaFs.seedFile('/slices/a.zip', 'x');
      runner.setResponse('unzip', ['-Z1', '/slices/a.zip'], {
        stdout: 'Takeout/\nTakeout/Google Photos/\nTakeout/Google Photos/Album/IMG_1.jpg',
        stderr: '',
        exitCode: 0,
      });

      const entries = await reader.listArchiveEntries('/slices/a.zip');

      expect(entries).toHaveLength(3);
      expect(entries[2]).toContain('IMG_1.jpg');
    });

    it('lists tgz entries via tar -tzf', async () => {
      mediaFs.seedFile('/slices/a.tgz', 'x');
      runner.setResponse('tar', ['-tzf', '/slices/a.tgz'], {
        stdout: 'Takeout/Google Photos/IMG_1.jpg',
        stderr: '',
        exitCode: 0,
      });

      const entries = await reader.listArchiveEntries('/slices/a.tgz');

      expect(entries).toEqual(['Takeout/Google Photos/IMG_1.jpg']);
    });

    it('throws when listing fails', async () => {
      runner.setResponse('tar', ['-tzf', '/slices/bad.tgz'], {
        stdout: '',
        stderr: 'tar: corrupted archive',
        exitCode: 2,
      });

      await expect(reader.listArchiveEntries('/slices/bad.tgz')).rejects.toThrow(
        'tar failed to list bad.tgz',
      );
    });
  });

  describe('extractAll', () => {
    it('extracts zip and tgz slices into per-slice directories', async () => {
      mediaFs.seedFile('/slices/takeout-001.zip', 'a');
      mediaFs.seedFile('/slices/takeout-002.tgz', 'b');
      runner.setResponse('unzip', ['-Z1', '/slices/takeout-001.zip'], {
        stdout: 'Takeout/Google Photos/IMG_1.jpg',
        stderr: '',
        exitCode: 0,
      });
      runner.setResponse('tar', ['-tzf', '/slices/takeout-002.tgz'], {
        stdout: 'Takeout/Google Photos/IMG_2.jpg',
        stderr: '',
        exitCode: 0,
      });

      const extracted = await reader.extractAll('/slices');

      expect(extracted).toHaveLength(2);
      expect(extracted[0].dir).toBe('/slices/_extracted/takeout-001');
      expect(extracted[0].entries).toBe(1);
      expect(runner.commands).toContainEqual(
        expect.objectContaining({
          command: 'unzip',
          args: ['-q', '/slices/takeout-001.zip', '-d', '/slices/_extracted/takeout-001'],
        }),
      );
      expect(runner.commands).toContainEqual(
        expect.objectContaining({
          command: 'tar',
          args: ['-xzf', '/slices/takeout-002.tgz', '-C', '/slices/_extracted/takeout-002'],
        }),
      );
    });

    it('skips a slice that fails extraction and continues with the rest', async () => {
      mediaFs.seedFile('/slices/good.zip', 'a');
      mediaFs.seedFile('/slices/bad.zip', 'b');
      runner.setResponse('unzip', ['-Z1', '/slices/bad.zip'], {
        stdout: '',
        stderr: 'End-of-central-directory signature not found',
        exitCode: 9,
      });

      const extracted = await reader.extractAll('/slices');

      expect(extracted.map((e) => e.slice.name)).toEqual(['good.zip']);
      expect(
        logger.messages.some((m) => m.level === 'WARN' && m.message.includes('extraction skipped')),
      ).toBe(true);
    });
  });

  describe('cleanupExtracted', () => {
    it('removes the extraction directory', async () => {
      mediaFs.seedFile('/slices/_extracted/takeout-001/file.jpg', 'x');

      await reader.cleanupExtracted('/slices');

      expect(mediaFs.files.has('/slices/_extracted/takeout-001/file.jpg')).toBe(false);
    });
  });
});
