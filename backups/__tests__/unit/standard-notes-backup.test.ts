import { StandardNotesBackup, StandardNotesBackupConfig } from '../../src/standard-notes-backup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

function setupSourceFs(fs: MockFileSystem, homeDir: string): string {
  const sourceDir = `${homeDir}/garret.patten@proton.me/Plaintext Backups`;
  fs.directories.add(sourceDir);
  fs.directories.add(`${sourceDir}/Books`);

  fs.files.set(`${sourceDir}/New Years Resolutions 2026-ba6e_txt`, '# Resolutions\n');
  fs.files.set(`${sourceDir}/Books/Book List-0efa_txt`, '# Book List\n');
  fs.files.set(`${sourceDir}/Books/Book Notes_ Nichomachean Ethics-222e_txt`, '# Ethics\n');
  return sourceDir;
}

describe('StandardNotesBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let archive: MockArchive;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    archive = new MockArchive();

    context = {
      logger,
      fs,
      http,
      git: {
        clone: async () => undefined,
        remoteUpdate: async () => undefined,
        pushMirror: async () => undefined,
        checkout: async () => undefined,
        getDefaultBranch: async () => null,
      },
      sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
      archive,
      dateProvider: new MockDateProvider(new Date('2024-06-15T08:30:45Z')),
      env: {},
      runner,
    };

    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });
  });

  it('cleans note names and zips the backup', async () => {
    const homeDir = '/home/user';
    setupSourceFs(fs, homeDir);

    const config: StandardNotesBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await new StandardNotesBackup(context).run(config);

    expect(fs.files.get('/home/user/Standard-Notes_2024-06-15/new-years-resolutions-2026.md')).toBe(
      '# Resolutions\n',
    );
    expect(fs.files.get('/home/user/Standard-Notes_2024-06-15/books/book-list.md')).toBe(
      '# Book List\n',
    );
    expect(
      fs.files.get('/home/user/Standard-Notes_2024-06-15/books/book-notes-nichomachean-ethics.md'),
    ).toBe('# Ethics\n');
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Standard-Notes_2024-06-15');
    expect(archive.calls[0].outputFileName).toBe('Standard-Notes_2024-06-15.zip');
    expect(archive.calls[0].cwd).toBe(homeDir);
    expect(
      logger.messages.some((m) => m.message.includes('Standard Notes backup completed!')),
    ).toBe(true);
  });

  it('exits gracefully when the source directory does not exist', async () => {
    const config: StandardNotesBackupConfig = {
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await new StandardNotesBackup(context).run(config);

    expect(archive.calls).toHaveLength(0);
    expect(
      logger.messages.some((m) =>
        m.message.includes('Plaintext Backups must be enabled for Standard Notes'),
      ),
    ).toBe(true);
  });

  it('handles duplicate cleaned filenames', async () => {
    const homeDir = '/home/user';
    const sourceDir = `${homeDir}/garret.patten@proton.me/Plaintext Backups`;
    fs.directories.add(sourceDir);
    fs.files.set(`${sourceDir}/Note One-abcd_txt`, 'content 1');
    fs.files.set(`${sourceDir}/Note One-ef01_txt`, 'content 2');

    const config: StandardNotesBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await new StandardNotesBackup(context).run(config);

    expect(fs.files.get('/home/user/Standard-Notes_2024-06-15/note-one.md')).toBe('content 1');
    expect(fs.files.get('/home/user/Standard-Notes_2024-06-15/note-one_1.md')).toBe('content 2');
  });

  it('fails when zip is not installed', async () => {
    runner.setResponse('zip', ['--version'], { stdout: '', stderr: 'not found', exitCode: 127 });

    const homeDir = '/home/user';
    setupSourceFs(fs, homeDir);

    const config: StandardNotesBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await expect(new StandardNotesBackup(context).run(config)).rejects.toThrow(
      'Missing required dependency: zip',
    );
  });
});
