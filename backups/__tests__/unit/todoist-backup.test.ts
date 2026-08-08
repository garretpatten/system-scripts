import { TodoistBackup, TodoistBackupConfig } from '../../src/todoist-backup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

describe('TodoistBackup', () => {
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

    runner.setResponse('curl', ['--version'], { stdout: 'curl 8.0', stderr: '', exitCode: 0 });
    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });
  });

  it('writes tasks, projects, and labels to disk and zips them', async () => {
    http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
      statusCode: 200,
      body: JSON.stringify({
        results: [{ id: '1', content: 'Task 1' }],
        next_cursor: null,
      }),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/projects?limit=200', {
      statusCode: 200,
      body: JSON.stringify({
        results: [{ id: '1', name: 'Inbox' }],
        next_cursor: null,
      }),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/labels?limit=200', {
      statusCode: 200,
      body: JSON.stringify({
        results: [{ id: '1', name: 'urgent' }],
        next_cursor: null,
      }),
    });

    const config: TodoistBackupConfig = {
      apiToken: 'token123',
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await new TodoistBackup(context).run(config);

    expect(fs.files.get('/home/user/Todoist-Export_2024-06-15/tasks.json')).toBe(
      JSON.stringify([{ id: '1', content: 'Task 1' }], null, 2),
    );
    expect(fs.files.get('/home/user/Todoist-Export_2024-06-15/projects.json')).toBe(
      JSON.stringify([{ id: '1', name: 'Inbox' }], null, 2),
    );
    expect(fs.files.get('/home/user/Todoist-Export_2024-06-15/labels.json')).toBe(
      JSON.stringify([{ id: '1', name: 'urgent' }], null, 2),
    );
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Todoist-Export_2024-06-15');
  });
});
