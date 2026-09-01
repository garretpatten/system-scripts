import { BackupOrchestrator } from '../../src/run-all.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

describe('BackupOrchestrator', () => {
  let context: BackupContext;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let http: MockHttpClient;
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    const archive = new MockArchive();

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
      env: {
        HOME: '/home/user',
        GITHUB_TOKEN: 'gh-token',
        GITLAB_TOKEN: 'gl-token',
        GITLAB_NAMESPACE: 'octocat',
        TODOIST_API_TOKEN: 'todoist-token',
        NOTION_API_TOKEN: 'notion-token',
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
        GOOGLE_REFRESH_TOKEN: 'google-refresh-token',
      },
      runner,
    };

    runner.setResponse('git', ['--version'], {
      stdout: 'git version 2.0',
      stderr: '',
      exitCode: 0,
    });
    runner.setResponse('curl', ['--version'], { stdout: 'curl 8.0', stderr: '', exitCode: 0 });
    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });
    runner.setResponse('pgrep', ['-i', 'brave'], { stdout: '', stderr: '', exitCode: 1 });
    runner.setResponse('pgrep', ['-i', 'chrome'], { stdout: '', stderr: '', exitCode: 1 });

    const braveBookmarksPath = '/home/user/.config/BraveSoftware/Brave-Browser/Default/Bookmarks';
    fs.files.set(
      braveBookmarksPath,
      JSON.stringify({
        checksum: 'abc',
        version: 1,
        roots: {
          bookmark_bar: {
            id: '1',
            name: 'Bookmarks bar',
            type: 'folder',
            date_added: '0',
            date_modified: '0',
            children: [],
          },
        },
      }),
    );
    fs.existsPaths.add(braveBookmarksPath);

    const chromeBookmarksPath = '/home/user/.config/google-chrome/Default/Bookmarks';
    fs.files.set(
      chromeBookmarksPath,
      JSON.stringify({
        checksum: 'def',
        version: 1,
        roots: {
          bookmark_bar: {
            id: '1',
            name: 'Bookmarks bar',
            type: 'folder',
            date_added: '0',
            date_modified: '0',
            children: [],
          },
        },
      }),
    );
    fs.existsPaths.add(chromeBookmarksPath);
  });

  it('reports success when all backups succeed', async () => {
    http.setResponse('GET', 'https://api.github.com/user', {
      statusCode: 200,
      body: JSON.stringify({ login: 'octocat' }),
    });
    http.setResponse(
      'GET',
      'https://api.github.com/user/repos?page=1&per_page=100&type=all&sort=updated',
      {
        statusCode: 200,
        body: JSON.stringify([]),
      },
    );
    http.setResponse('GET', 'https://gitlab.com/api/v4/namespaces?search=octocat', {
      statusCode: 200,
      body: JSON.stringify([{ id: 42, full_path: 'octocat' }]),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/projects?limit=200', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/labels?limit=200', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('POST', 'https://api.notion.com/v1/search', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'google-access-token' }),
    });
    http.setResponse(
      'GET',
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
      {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      },
    );
    http.setResponse(
      'GET',
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1000',
      {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      },
    );

    const orchestrator = new BackupOrchestrator(context);
    await orchestrator.run({ homeDir: '/home/user', logDir: '/logs' });

    expect(
      logger.messages.some((m) => m.message.includes('All backups completed successfully')),
    ).toBe(true);
    expect(process.exitCode).not.toBe(1);
  });

  it('continues with remaining backups when Chrome bookmarks are missing', async () => {
    fs.files.delete('/home/user/.config/google-chrome/Default/Bookmarks');
    fs.existsPaths.delete('/home/user/.config/google-chrome/Default/Bookmarks');
    fs.files.delete('/home/user/.config/google-chrome/Default/AccountBookmarks');
    fs.existsPaths.delete('/home/user/.config/google-chrome/Default/AccountBookmarks');

    http.setResponse('GET', 'https://api.github.com/user', {
      statusCode: 200,
      body: JSON.stringify({ login: 'octocat' }),
    });
    http.setResponse(
      'GET',
      'https://api.github.com/user/repos?page=1&per_page=100&type=all&sort=updated',
      {
        statusCode: 200,
        body: JSON.stringify([]),
      },
    );
    http.setResponse('GET', 'https://gitlab.com/api/v4/namespaces?search=octocat', {
      statusCode: 200,
      body: JSON.stringify([{ id: 42, full_path: 'octocat' }]),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/projects?limit=200', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/labels?limit=200', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('POST', 'https://api.notion.com/v1/search', {
      statusCode: 200,
      body: JSON.stringify({ results: [], next_cursor: null }),
    });
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'google-access-token' }),
    });
    http.setResponse(
      'GET',
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
      {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      },
    );
    http.setResponse(
      'GET',
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1000',
      {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      },
    );

    const orchestrator = new BackupOrchestrator(context);
    await orchestrator.run({ homeDir: '/home/user', logDir: '/logs' });

    expect(
      logger.messages.some(
        (m) => m.message.includes('chrome-bookmarks') && m.message.includes('FAILED'),
      ),
    ).toBe(true);
    expect(logger.messages.some((m) => m.message.includes('One or more backups failed'))).toBe(
      true,
    );
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
  });
});
