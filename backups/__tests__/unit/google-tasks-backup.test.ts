import { GoogleTasksBackup, GoogleTasksBackupConfig } from '../../src/google-tasks-backup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

const LISTS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1000';
const TASKS_QUERY = 'maxResults=100&showCompleted=true&showDeleted=true&showHidden=true';

describe('GoogleTasksBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let archive: MockArchive;
  let config: GoogleTasksBackupConfig;

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

    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token' }),
    });

    config = {
      credentials: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
      },
      homeDir: '/home/user',
      logDir: '/logs',
      showCompleted: true,
      showDeleted: true,
      showHidden: true,
    };
  });

  function mockTwoTaskLists(): void {
    http.setResponse('GET', LISTS_URL, {
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { id: 'list1', title: 'My Tasks' },
          { id: 'list2', title: 'Work' },
        ],
      }),
    });
    http.setResponse(
      'GET',
      `https://tasks.googleapis.com/tasks/v1/lists/list1/tasks?${TASKS_QUERY}`,
      {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'task1', title: 'Buy milk' }] }),
      },
    );
    http.setResponse(
      'GET',
      `https://tasks.googleapis.com/tasks/v1/lists/list2/tasks?${TASKS_QUERY}`,
      {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'task2', title: 'Write report' }] }),
      },
    );
  }

  it('exports task list metadata and tasks, then zips them', async () => {
    mockTwoTaskLists();

    await new GoogleTasksBackup(context).run(config);

    const exportDir = '/home/user/Google-Tasks-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/task-lists.json`)).toBe(
      JSON.stringify(
        [
          { id: 'list1', title: 'My Tasks' },
          { id: 'list2', title: 'Work' },
        ],
        null,
        2,
      ),
    );
    expect(fs.files.get(`${exportDir}/My Tasks/task-list.json`)).toBe(
      JSON.stringify({ id: 'list1', title: 'My Tasks' }, null, 2),
    );
    expect(fs.files.get(`${exportDir}/My Tasks/tasks.json`)).toBe(
      JSON.stringify([{ id: 'task1', title: 'Buy milk' }], null, 2),
    );
    expect(fs.files.get(`${exportDir}/Work/tasks.json`)).toBe(
      JSON.stringify([{ id: 'task2', title: 'Write report' }], null, 2),
    );
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Google-Tasks-Export_2024-06-15');
    expect(archive.calls[0].outputFileName).toBe('Google-Tasks-Export_2024-06-15.zip');
    expect(archive.calls[0].cwd).toBe('/home/user');
  });

  it('passes inclusion flags to the tasks endpoint', async () => {
    config.showCompleted = false;
    config.showDeleted = false;
    config.showHidden = false;
    http.setResponse('GET', LISTS_URL, {
      statusCode: 200,
      body: JSON.stringify({ items: [{ id: 'list1', title: 'My Tasks' }] }),
    });
    http.setResponse(
      'GET',
      'https://tasks.googleapis.com/tasks/v1/lists/list1/tasks?maxResults=100&showCompleted=false&showDeleted=false&showHidden=false',
      {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      },
    );

    await new GoogleTasksBackup(context).run(config);

    expect(fs.files.get('/home/user/Google-Tasks-Export_2024-06-15/My Tasks/tasks.json')).toBe(
      '[]',
    );
  });

  it('continues the export when one task list fails', async () => {
    http.setResponse('GET', LISTS_URL, {
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { id: 'list1', title: 'My Tasks' },
          { id: 'broken', title: 'Broken' },
        ],
      }),
    });
    http.setResponse(
      'GET',
      `https://tasks.googleapis.com/tasks/v1/lists/list1/tasks?${TASKS_QUERY}`,
      {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'task1', title: 'Buy milk' }] }),
      },
    );

    await new GoogleTasksBackup(context).run(config);

    const exportDir = '/home/user/Google-Tasks-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/Broken/tasks.json`)).toBe('[]');
    expect(fs.files.get(`${exportDir}/My Tasks/tasks.json`)).toBe(
      JSON.stringify([{ id: 'task1', title: 'Buy milk' }], null, 2),
    );
    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('Failed to export tasks for task list'),
      ),
    ).toBe(true);
    expect(archive.calls).toHaveLength(1);
  });

  it('throws when Google credentials are missing', async () => {
    config.credentials = { clientId: '', clientSecret: '', refreshToken: '' };

    await expect(new GoogleTasksBackup(context).run(config)).rejects.toThrow(
      'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in env or .env',
    );
  });
});
