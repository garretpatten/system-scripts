import {
  ChromeBookmarksBackup,
  ChromeBookmarksBackupConfig,
} from '../../src/chrome-bookmarks-backup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

function sampleBookmarksJson(): string {
  return JSON.stringify({
    checksum: 'abc123',
    version: 1,
    roots: {
      bookmark_bar: {
        id: '1',
        name: 'Bookmarks bar',
        type: 'folder',
        date_added: '13200000000000000',
        date_modified: '13200000000000000',
        children: [
          {
            id: '2',
            name: 'Example',
            type: 'url',
            url: 'https://example.com',
            date_added: '13200000000000000',
            date_modified: '13200000000000000',
          },
          {
            id: '3',
            name: 'Folder <One>',
            type: 'folder',
            date_added: '13200000000000000',
            date_modified: '13200000000000000',
            children: [
              {
                id: '4',
                name: 'Nested & Co.',
                type: 'url',
                url: 'https://nested.example.com/?a=1&b=2',
                date_added: '13200000000000000',
                date_modified: '13200000000000000',
              },
            ],
          },
        ],
      },
      other: {
        id: '5',
        name: 'Other bookmarks',
        type: 'folder',
        date_added: '13200000000000000',
        date_modified: '13200000000000000',
        children: [],
      },
      synced: {
        id: '6',
        name: 'Mobile bookmarks',
        type: 'folder',
        date_added: '13200000000000000',
        date_modified: '13200000000000000',
        children: [
          {
            id: '7',
            name: 'Mobile Link',
            type: 'url',
            url: 'https://mobile.example.com',
            date_added: '13200000000000000',
            date_modified: '13200000000000000',
          },
        ],
      },
    },
  });
}

describe('ChromeBookmarksBackup', () => {
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

    runner.setResponse('pgrep', ['-i', 'chrome'], { stdout: '', stderr: '', exitCode: 1 });
  });

  it('finds Linux bookmarks path, writes HTML and JSON copies', async () => {
    const homeDir = '/home/user';
    const linuxBookmarks = `${homeDir}/.config/google-chrome/Default/Bookmarks`;
    fs.files.set(linuxBookmarks, sampleBookmarksJson());
    fs.existsPaths.add(linuxBookmarks);

    const config: ChromeBookmarksBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await new ChromeBookmarksBackup(context).run(config);

    expect(
      logger.messages.some((m) =>
        m.message.includes('Chrome bookmarks backup completed successfully'),
      ),
    ).toBe(true);
    expect(fs.files.get('/home/user/chrome-bookmarks_2024-06-15.json')).toBe(sampleBookmarksJson());

    const html = fs.files.get('/home/user/chrome-bookmarks_2024-06-15.html') ?? '';
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('<TITLE>Bookmarks</TITLE>');
    expect(html).toContain('<H1>Bookmarks</H1>');
    expect(html).toContain(
      '<DT><H3 ADD_DATE="1555526400" LAST_MODIFIED="1555526400">Bookmarks bar</H3>',
    );
    expect(html).toContain(
      '<DT><A HREF="https://example.com" ADD_DATE="1555526400" LAST_MODIFIED="1555526400">Example</A>',
    );
    expect(html).toContain(
      '<DT><H3 ADD_DATE="1555526400" LAST_MODIFIED="1555526400">Folder &lt;One&gt;</H3>',
    );
    expect(html).toContain(
      '<DT><A HREF="https://nested.example.com/?a=1&amp;b=2" ADD_DATE="1555526400" LAST_MODIFIED="1555526400">Nested &amp; Co.</A>',
    );
    expect(html).toContain(
      '<DT><H3 ADD_DATE="1555526400" LAST_MODIFIED="1555526400">Mobile bookmarks</H3>',
    );
    expect(html).toContain(
      '<DT><A HREF="https://mobile.example.com" ADD_DATE="1555526400" LAST_MODIFIED="1555526400">Mobile Link</A>',
    );
    expect(html).toContain('</DL><p>');
  });

  it('falls back to the macOS path when the Linux path does not exist', async () => {
    const homeDir = '/Users/user';
    const macosBookmarks = `${homeDir}/Library/Application Support/Google/Chrome/Default/Bookmarks`;
    fs.files.set(macosBookmarks, sampleBookmarksJson());
    fs.existsPaths.add(macosBookmarks);

    const config: ChromeBookmarksBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await new ChromeBookmarksBackup(context).run(config);

    const html = fs.files.get('/Users/user/chrome-bookmarks_2024-06-15.html') ?? '';
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(logger.messages.some((m) => m.message.includes(macosBookmarks))).toBe(true);
  });

  it('warns when Chrome appears to be running', async () => {
    runner.setResponse('pgrep', ['-i', 'chrome'], {
      stdout: '1234\n5678',
      stderr: '',
      exitCode: 0,
    });

    const homeDir = '/home/user';
    const linuxBookmarks = `${homeDir}/.config/google-chrome/Default/Bookmarks`;
    fs.files.set(linuxBookmarks, sampleBookmarksJson());
    fs.existsPaths.add(linuxBookmarks);

    const config: ChromeBookmarksBackupConfig = {
      homeDir,
      logDir: '/logs',
    };

    await new ChromeBookmarksBackup(context).run(config);

    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('Chrome appears to be running'),
      ),
    ).toBe(true);
  });

  it('skips the JSON copy when copyJson is false', async () => {
    const homeDir = '/home/user';
    const linuxBookmarks = `${homeDir}/.config/google-chrome/Default/Bookmarks`;
    fs.files.set(linuxBookmarks, sampleBookmarksJson());
    fs.existsPaths.add(linuxBookmarks);

    const config: ChromeBookmarksBackupConfig = {
      homeDir,
      logDir: '/logs',
      copyJson: false,
    };

    await new ChromeBookmarksBackup(context).run(config);

    expect(fs.files.has('/home/user/chrome-bookmarks_2024-06-15.json')).toBe(false);
    expect(fs.files.has('/home/user/chrome-bookmarks_2024-06-15.html')).toBe(true);
  });

  it('fails fast when no bookmarks file is found', async () => {
    const config: ChromeBookmarksBackupConfig = {
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await expect(new ChromeBookmarksBackup(context).run(config)).rejects.toThrow(
      'Chrome bookmarks file not found',
    );
  });
});
