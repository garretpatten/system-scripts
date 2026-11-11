import {
  copyZipToExternalDrive,
  EXTERNAL_DRIVE_LABEL,
  formatExportDirName,
  moveZipToExportDir,
  resolveDriveExportDir,
  resolveExternalDriveMount,
  resolveLocalExportDir,
} from '../../src/export-dir.js';
import { MockFileSystem, MockLogger } from '../test-helpers.js';

describe('export-dir helpers', () => {
  const date = new Date('2024-06-15T08:30:45Z');

  describe('formatExportDirName', () => {
    it('returns a dated Exports directory name', () => {
      expect(formatExportDirName(date)).toBe('Exports_2024-06-15');
    });
  });

  describe('resolveLocalExportDir', () => {
    it('places the dated export dir under an Exports parent in homeDir', () => {
      expect(resolveLocalExportDir('/home/user', date)).toBe(
        '/home/user/Exports/Exports_2024-06-15',
      );
    });
  });

  describe('resolveExternalDriveMount', () => {
    let fs: MockFileSystem;

    beforeEach(() => {
      fs = new MockFileSystem();
    });

    it('finds the drive by volume label under common mount points', async () => {
      fs.directories.add('/run/media/garret/T7 Shield');

      expect(await resolveExternalDriveMount(fs, { USER: 'garret' })).toBe(
        '/run/media/garret/T7 Shield',
      );
    });

    it('finds the drive under /Volumes on macOS', async () => {
      fs.directories.add('/Volumes/T7 Shield');

      expect(await resolveExternalDriveMount(fs, {})).toBe('/Volumes/T7 Shield');
    });

    it('returns null when the drive is not mounted', async () => {
      expect(await resolveExternalDriveMount(fs, { USER: 'garret' })).toBeNull();
    });

    it('uses the drive label constant', () => {
      expect(EXTERNAL_DRIVE_LABEL).toBe('T7 Shield');
    });
  });

  describe('resolveDriveExportDir', () => {
    it('places the dated export dir under Garret/Exports on the drive', () => {
      expect(resolveDriveExportDir('/run/media/garret/T7 Shield', date)).toBe(
        '/run/media/garret/T7 Shield/Garret/Exports/Exports_2024-06-15',
      );
    });
  });

  describe('moveZipToExportDir', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
    });

    it('copies the zip into the export dir and removes the original', async () => {
      fs.files.set('/home/user/Notion-Export_2024-06-15.zip', 'zip-content');

      const destination = await moveZipToExportDir(
        fs,
        logger,
        '/home/user/Notion-Export_2024-06-15.zip',
        '/home/user/Exports/Exports_2024-06-15',
      );

      expect(destination).toBe(
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
      );
      expect(
        fs.files.get('/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip'),
      ).toBe('zip-content');
      expect(fs.files.get('/home/user/Notion-Export_2024-06-15.zip')).toBeUndefined();
    });

    it('creates the export dir when it does not exist', async () => {
      fs.files.set('/home/user/Notion-Export_2024-06-15.zip', 'zip-content');

      await moveZipToExportDir(
        fs,
        logger,
        '/home/user/Notion-Export_2024-06-15.zip',
        '/home/user/Exports/Exports_2024-06-15',
      );

      expect(fs.directories.has('/home/user/Exports/Exports_2024-06-15')).toBe(true);
    });
  });

  describe('copyZipToExternalDrive', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
    });

    it('copies the zip into the drive export dir', async () => {
      fs.files.set(
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        'zip-content',
      );

      const ok = await copyZipToExternalDrive(
        fs,
        logger,
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        '/run/media/garret/T7 Shield',
        date,
      );

      expect(ok).toBe(true);
      expect(
        fs.files.get(
          '/run/media/garret/T7 Shield/Garret/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        ),
      ).toBe('zip-content');
    });

    it('warns and returns false when the copy fails', async () => {
      const ok = await copyZipToExternalDrive(
        fs,
        logger,
        '/home/user/Exports/Exports_2024-06-15/missing.zip',
        '/run/media/garret/T7 Shield',
        date,
      );

      expect(ok).toBe(false);
      expect(logger.messages.some((m) => m.level === 'WARN')).toBe(true);
    });
  });
});
