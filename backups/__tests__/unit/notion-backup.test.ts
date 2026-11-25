import { NotionBackup, NotionBackupConfig } from '../../src/notion-backup.js';
import { resetExternalDriveMountCache } from '../../src/export-dir.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

const SEARCH_URL = 'https://api.notion.com/v1/search';
const PAGE_BLOCKS_URL = 'https://api.notion.com/v1/blocks/page-1/children';
const DATABASE_URL = 'https://api.notion.com/v1/databases/db-1';
const DATABASE_QUERY_URL = 'https://api.notion.com/v1/databases/db-1/query';

describe('NotionBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let archive: MockArchive;
  let config: NotionBackupConfig;

  beforeEach(() => {
    process.exitCode = undefined;
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    archive = new MockArchive(fs);
    resetExternalDriveMountCache();

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

    runner.setResponse('curl', ['--version'], { stdout: 'curl 8.0', stderr: '', exitCode: 0 });
    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });

    config = {
      apiToken: 'token123',
      homeDir: '/home/user',
      logDir: '/logs',
      rateLimitDelayMs: 0,
    };
  });

  const mockWorkspace = () => {
    http.setResponse('POST', SEARCH_URL, {
      statusCode: 200,
      body: JSON.stringify({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: {
              title: { type: 'title', title: [{ plain_text: 'My Page' }] },
            },
            parent: {},
          },
          {
            id: 'db-1',
            object: 'database',
            title: [{ plain_text: 'My Database' }],
            parent: {},
          },
        ],
        next_cursor: null,
      }),
    });
    http.setResponse('GET', PAGE_BLOCKS_URL, {
      statusCode: 200,
      body: JSON.stringify({
        results: [{ id: 'block-1', type: 'paragraph', has_children: false }],
        next_cursor: null,
      }),
    });
    http.setResponse('GET', DATABASE_URL, {
      statusCode: 200,
      body: JSON.stringify({ title: [], description: [], properties: {} }),
    });
    http.setResponse('POST', DATABASE_QUERY_URL, {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
  };

  it('exports pages and databases and zips the result', async () => {
    mockWorkspace();

    await new NotionBackup(context).run(config);

    const exportDir = '/home/user/Notion-Export_2024-06-15';
    const pageFile = fs.files.get(`${exportDir}/My Page.md`);
    expect(pageFile).toContain('# My Page');
    const databaseFile = fs.files.get(`${exportDir}/My Database.md`);
    expect(databaseFile).toContain('# My Database');
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Notion-Export_2024-06-15');
    expect(archive.calls[0].cwd).toBe('/home/user');
    expect(fs.files.get('/home/user/Notion-Export_2024-06-15.zip')).toBeUndefined();
    expect(fs.files.get('/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip')).toBe(
      'zip-content',
    );
    expect(logger.messages.some((m) => m.message.includes('Pages exported: 1'))).toBe(true);
    expect(logger.messages.some((m) => m.message.includes('Databases exported: 1'))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('sets the exit code when a page export fails', async () => {
    http.setResponse('POST', SEARCH_URL, {
      statusCode: 200,
      body: JSON.stringify({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: {
              title: { type: 'title', title: [{ plain_text: 'Broken Page' }] },
            },
            parent: {},
          },
        ],
        next_cursor: null,
      }),
    });
    http.setResponse('GET', PAGE_BLOCKS_URL, {
      statusCode: 403,
      body: JSON.stringify({ message: 'Forbidden' }),
    });

    await new NotionBackup(context).run(config);

    expect(
      logger.messages.some(
        (m) => m.level === 'ERROR' && m.message.includes('Failed to export page: Broken Page'),
      ),
    ).toBe(true);
    expect(logger.messages.some((m) => m.message.includes('Some objects failed to export'))).toBe(
      true,
    );
    expect(process.exitCode).toBe(1);
    expect(archive.calls).toHaveLength(1);

    process.exitCode = undefined;
  });

  it('sets the exit code when a database query fails', async () => {
    http.setResponse('POST', SEARCH_URL, {
      statusCode: 200,
      body: JSON.stringify({
        results: [
          {
            id: 'db-1',
            object: 'database',
            title: [{ plain_text: 'Broken Database' }],
            parent: {},
          },
        ],
        next_cursor: null,
      }),
    });
    http.setResponse('GET', DATABASE_URL, {
      statusCode: 200,
      body: JSON.stringify({ title: [], description: [], properties: {} }),
    });
    http.setResponse('POST', DATABASE_QUERY_URL, {
      statusCode: 401,
      body: JSON.stringify({ message: 'Unauthorized' }),
    });

    await new NotionBackup(context).run(config);

    expect(
      logger.messages.some(
        (m) =>
          m.level === 'ERROR' && m.message.includes('Failed to export database: Broken Database'),
      ),
    ).toBe(true);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
  });

  it('warns and exits cleanly when the workspace is empty', async () => {
    http.setResponse('POST', SEARCH_URL, {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });

    await new NotionBackup(context).run(config);

    expect(logger.messages.some((m) => m.message.includes('No pages or databases found'))).toBe(
      true,
    );
    expect(archive.calls).toHaveLength(0);
    expect(process.exitCode).toBeUndefined();
  });

  it('throws when dependencies are missing', async () => {
    runner.setResponse('zip', ['--version'], { stdout: '', stderr: 'not found', exitCode: 127 });

    await expect(new NotionBackup(context).run(config)).rejects.toThrow(
      'Missing required dependency: zip',
    );
  });
});
