import {
  copyArchiveToExternalDrive,
  copyZipToExternalDrive,
  EXTERNAL_DRIVE_LABEL,
  formatExportDirName,
  moveZipToExportDir,
  resetExternalDriveMountCache,
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
      resetExternalDriveMountCache();
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

    it('ignores a file that matches the volume label', async () => {
      fs.files.set('/Volumes/T7 Shield', 'not-a-directory');

      expect(await resolveExternalDriveMount(fs, {})).toBeNull();
    });

    it('skips user-scoped mount points when no user is known', async () => {
      fs.directories.add('/run/media/garret/T7 Shield');

      expect(await resolveExternalDriveMount(fs, {})).toBeNull();
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

    it('honors an env override for the drive subpath', () => {
      expect(
        resolveDriveExportDir('/run/media/garret/T7 Shield', date, {
          EXTERNAL_DRIVE_EXPORT_SUBPATH: 'Backup/Archives',
        }),
      ).toBe('/run/media/garret/T7 Shield/Backup/Archives/Exports_2024-06-15');
    });
  });

  describe('moveZipToExportDir', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
    });

    it('moves the zip into the export dir and removes the original', async () => {
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

    it('warns and returns the original path when the move fails', async () => {
      const destination = await moveZipToExportDir(
        fs,
        logger,
        '/home/user/missing.zip',
        '/home/user/Exports/Exports_2024-06-15',
      );

      expect(destination).toBe('/home/user/missing.zip');
      expect(logger.messages.some((m) => m.level === 'WARN')).toBe(true);
    });
  });

  describe('copyZipToExternalDrive', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
    });

    it('copies the zip into the destination dir', async () => {
      fs.files.set(
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        'zip-content',
      );

      const ok = await copyZipToExternalDrive(
        fs,
        logger,
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        '/run/media/garret/T7 Shield/Garret/Exports/Exports_2024-06-15',
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
        '/run/media/garret/T7 Shield/Garret/Exports/Exports_2024-06-15',
      );

      expect(ok).toBe(false);
      expect(logger.messages.some((m) => m.level === 'WARN')).toBe(true);
    });
  });

  describe('copyArchiveToExternalDrive', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
      resetExternalDriveMountCache();
    });

    it('copies the archive to the drive export dir when mounted', async () => {
      fs.directories.add('/Volumes/T7 Shield');
      const zipPath = '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip';
      fs.files.set(zipPath, 'zip-content');

      await copyArchiveToExternalDrive(fs, {}, logger, zipPath, date);

      expect(
        fs.files.get(
          '/Volumes/T7 Shield/Garret/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        ),
      ).toBe('zip-content');
    });

    it('honors the drive subpath env override', async () => {
      fs.directories.add('/Volumes/T7 Shield');
      const zipPath = '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip';
      fs.files.set(zipPath, 'zip-content');

      await copyArchiveToExternalDrive(
        fs,
        { EXTERNAL_DRIVE_EXPORT_SUBPATH: 'Backup/Archives' },
        logger,
        zipPath,
        date,
      );

      expect(
        fs.files.get(
          '/Volumes/T7 Shield/Backup/Archives/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        ),
      ).toBe('zip-content');
    });

    it('warns and skips the copy when the drive is not mounted', async () => {
      const zipPath = '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip';
      fs.files.set(zipPath, 'zip-content');

      await copyArchiveToExternalDrive(fs, {}, logger, zipPath, date);

      expect(
        logger.messages.some((m) => m.level === 'WARN' && m.message.includes('T7 Shield')),
      ).toBe(true);
      expect(fs.files.get('/Volumes/T7 Shield/Garret/Exports/Exports_2024-06-15')).toBeUndefined();
    });
  });
});
