import { LocalBackup, LocalBackupConfig } from '../../src/local-backup.js';
import { BackupContext, GitRepository, SyncClient } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

class StubGitRepository implements GitRepository {
  clones: Array<{ url: string; path: string; mirror?: boolean }> = [];
  checkouts: Array<{ path: string; branch: string }> = [];
  defaultBranches = new Map<string, string | null>();

  async clone(url: string, path: string, options?: { mirror?: boolean }): Promise<void> {
    this.clones.push({ url, path, mirror: options?.mirror });
  }

  async remoteUpdate(): Promise<void> {}
  async pushMirror(): Promise<void> {}

  async checkout(path: string, branch: string): Promise<void> {
    this.checkouts.push({ path, branch });
  }

  async getDefaultBranch(path: string): Promise<string | null> {
    return this.defaultBranches.get(path) ?? null;
  }
}

class StubSyncClient implements SyncClient {
  results = new Map<string, { status: 'updated' | 'uncommitted' | 'failed'; output: string }>();

  async syncRepo(path: string) {
    return this.results.get(path) ?? { status: 'failed', output: 'No mock result' };
  }
}

describe('LocalBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let git: StubGitRepository;
  let sync: StubSyncClient;
  let archive: MockArchive;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    git = new StubGitRepository();
    sync = new StubSyncClient();
    archive = new MockArchive();

    context = {
      logger,
      fs,
      http,
      git,
      sync,
      archive,
      dateProvider: new MockDateProvider(new Date('2024-06-15T08:30:45Z')),
      env: {},
      runner,
    };

    runner.setResponse('git', ['--version'], { stdout: 'git version 2.0', stderr: '', exitCode: 0 });
    runner.setResponse('curl', ['--version'], { stdout: 'curl 8.0', stderr: '', exitCode: 0 });
    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });
  });

  it('creates directories and archives cloned repos', async () => {
    http.setResponse('GET', 'https://api.github.com/user', {
      statusCode: 200,
      body: JSON.stringify({ login: 'octocat' }),
    });
    http.setResponse(
      'GET',
      'https://api.github.com/user/repos?page=1&per_page=100&type=all&sort=updated',
      {
        statusCode: 200,
        body: JSON.stringify([
          {
            full_name: 'octocat/hello',
            name: 'hello',
            clone_url: 'https://github.com/octocat/hello.git',
            ssh_url: 'git@github.com:octocat/hello.git',
            archived: false,
          },
        ]),
      }
    );

    git.defaultBranches.set('/home/user/Code-Export_2024-06-15/hello', 'main');

    const config: LocalBackupConfig = {
      githubToken: 'token123',
      githubUsername: undefined,
      useSsh: false,
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await new LocalBackup(context).run(config);

    expect(git.clones).toHaveLength(1);
    expect(git.clones[0].url).toContain('x-access-token:token123@');
    expect(git.checkouts[0].branch).toBe('main');
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Code-Export_2024-06-15');
    expect(archive.calls[0].cwd).toBe('/home/user');
  });

  it('updates existing repositories', async () => {
    await fs.mkdir('/home/user/Code-Export_2024-06-15/hello', { recursive: true });
    sync.results.set('/home/user/Code-Export_2024-06-15/hello', {
      status: 'updated',
      output: 'SUCCESS: Updated',
    });

    http.setResponse(
      'GET',
      'https://api.github.com/users/octocat/repos?page=1&per_page=100&type=all&sort=updated',
      {
        statusCode: 200,
        body: JSON.stringify([
          {
            full_name: 'octocat/hello',
            name: 'hello',
            clone_url: 'https://github.com/octocat/hello.git',
            ssh_url: 'git@github.com:octocat/hello.git',
            archived: false,
          },
        ]),
      }
    );

    const config: LocalBackupConfig = {
      githubToken: undefined,
      githubUsername: 'octocat',
      useSsh: true,
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await new LocalBackup(context).run(config);

    expect(git.clones).toHaveLength(0);
    expect(logger.messages.some((m) => m.message.includes('Successfully cloned'))).toBe(false);
  });

  it('warns when no repositories are found', async () => {
    http.setResponse(
      'GET',
      'https://api.github.com/users/octocat/repos?page=1&per_page=100&type=all&sort=updated',
      {
        statusCode: 200,
        body: JSON.stringify([]),
      }
    );

    const config: LocalBackupConfig = {
      githubToken: undefined,
      githubUsername: 'octocat',
      useSsh: false,
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await new LocalBackup(context).run(config);

    expect(logger.messages.some((m) => m.message.includes('No repositories found'))).toBe(true);
    expect(archive.calls).toHaveLength(0);
  });

  it('exits with an error when dependencies are missing', async () => {
    runner.setResponse('git', ['--version'], { stdout: '', stderr: 'not found', exitCode: 127 });

    const config: LocalBackupConfig = {
      githubToken: undefined,
      githubUsername: 'octocat',
      useSsh: false,
      homeDir: '/home/user',
      logDir: '/logs',
    };

    await expect(new LocalBackup(context).run(config)).rejects.toThrow('Missing required dependencies');
  });
});
