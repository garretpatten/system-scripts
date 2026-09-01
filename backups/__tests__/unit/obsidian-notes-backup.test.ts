import { ObsidianNotesBackup, ObsidianNotesBackupConfig } from '../../src/obsidian-notes-backup.js';
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
  const sourceDir = `${homeDir}/Notes`;
  fs.directories.add(sourceDir);
  fs.directories.add(`${sourceDir}/Projects`);

  fs.files.set(`${sourceDir}/Daily Note.md`, '# Daily Note\n');
  fs.files.set(`${sourceDir}/Projects/Ideas.md`, '## Ideas\n');
  return sourceDir;
}

describe('ObsidianNotesBackup', () => {
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

  it('copies notes and zips the backup', async () => {
    const homeDir = '/home/user';
    setupSourceFs(fs, homeDir);

    const config: ObsidianNotesBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await new ObsidianNotesBackup(context).run(config);

    expect(fs.files.get('/home/user/Obsidian-Notes_2024-06-15/Daily Note.md')).toBe(
      '# Daily Note\n',
    );
    expect(fs.files.get('/home/user/Obsidian-Notes_2024-06-15/Projects/Ideas.md')).toBe(
      '## Ideas\n',
    );
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Obsidian-Notes_2024-06-15');
    expect(archive.calls[0].outputFileName).toBe('Obsidian-Notes_2024-06-15.zip');
    expect(archive.calls[0].cwd).toBe(homeDir);
    expect(
      logger.messages.some((m) => m.message.includes('Obsidian Notes backup completed!')),
    ).toBe(true);
  });

  it('exits gracefully when the source directory does not exist', async () => {
    const config: ObsidianNotesBackupConfig = {
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await new ObsidianNotesBackup(context).run(config);

    expect(archive.calls).toHaveLength(0);
    expect(
      logger.messages.some((m) => m.message.includes('Obsidian notes directory not found')),
    ).toBe(true);
  });

  it('fails when zip is not installed', async () => {
    runner.setResponse('zip', ['--version'], { stdout: '', stderr: 'not found', exitCode: 127 });

    const homeDir = '/home/user';
    setupSourceFs(fs, homeDir);

    const config: ObsidianNotesBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await expect(new ObsidianNotesBackup(context).run(config)).rejects.toThrow(
      'Missing required dependency: zip',
    );
  });
});
