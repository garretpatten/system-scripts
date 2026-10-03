import { GitLabMirror, GitLabMirrorConfig } from '../../src/gitlab-mirror.js';
import { BackupContext, GitRepository } from '../../src/types.js';
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
  updates: string[] = [];
  pushes: Array<{ path: string; remoteUrl: string }> = [];
  throwOnUrl: string | null = null;
  private throwAttempts = 0;

  async clone(url: string, path: string, options?: { mirror?: boolean }): Promise<void> {
    this.clones.push({ url, path, mirror: options?.mirror });
  }

  async remoteUpdate(path: string): Promise<void> {
    this.updates.push(path);
  }

  async pushMirror(path: string, remoteUrl: string): Promise<void> {
    this.pushes.push({ path, remoteUrl });
    if (this.throwOnUrl === remoteUrl && this.throwAttempts++ === 0) {
      this.pushes.pop();
      throw new Error(
        'git push mirror failed: remote: GitLab: You are not allowed to force push code to a protected branch on this project.\n' +
          ' ! [remote rejected] master -> master (pre-receive hook declined)\nerror: failed to push some refs',
      );
    }
  }

  async checkout(): Promise<void> {}
  async getDefaultBranch(): Promise<string | null> {
    return null;
  }
}

describe('GitLabMirror', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let git: StubGitRepository;
  let archive: MockArchive;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    git = new StubGitRepository();
    archive = new MockArchive();

    context = {
      logger,
      fs,
      http,
      git,
      sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
      archive,
      dateProvider: new MockDateProvider(new Date('2024-06-15T08:30:45Z')),
      env: {},
      runner,
    };

    runner.setResponse('git', ['--version'], {
      stdout: 'git version 2.0',
      stderr: '',
      exitCode: 0,
    });
    runner.setResponse('curl', ['--version'], { stdout: 'curl 8.0', stderr: '', exitCode: 0 });
  });

  function setHappyPathResponses(name: string): void {
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
            full_name: `octocat/${name}`,
            name,
            clone_url: `https://github.com/octocat/${name}.git`,
            ssh_url: `git@github.com:octocat/${name}.git`,
            archived: false,
          },
        ]),
      },
    );

    http.setResponse('GET', 'https://gitlab.com/api/v4/namespaces?search=octocat', {
      statusCode: 200,
      body: JSON.stringify([{ id: 42, full_path: 'octocat' }]),
    });
  }

  function setProjectExists(name: string, projectId: number): void {
    http.setResponse('GET', `https://gitlab.com/api/v4/projects/octocat%2F${name}`, {
      statusCode: 200,
      body: JSON.stringify({ id: projectId }),
    });
  }

  function baseConfig(autoCreate = true): GitLabMirrorConfig {
    return {
      githubToken: 'gh-token',
      githubUsername: undefined,
      useSsh: false,
      gitlabToken: 'gl-token',
      gitlabNamespace: 'octocat',
      autoCreateProjects: autoCreate,
      gitlabVisibility: 'private',
      gitlabHost: 'https://gitlab.com',
      backupRoot: '/backups',
    };
  }

  it('mirrors a repo to GitLab', async () => {
    setHappyPathResponses('hello');
    setProjectExists('hello', 123);

    await new GitLabMirror(context).run(baseConfig());

    expect(git.clones).toHaveLength(1);
    expect(git.clones[0].mirror).toBe(true);
    expect(git.clones[0].url).toContain('x-access-token:gh-token@');
    expect(git.pushes).toHaveLength(1);
    expect(git.pushes[0].remoteUrl).toBe('https://oauth2:gl-token@gitlab.com/octocat/hello.git');
  });

  it('reuses a stable mirrors directory across runs', async () => {
    setHappyPathResponses('hello');
    setProjectExists('hello', 123);
    fs.existsPaths.add('/backups/mirrors/hello.git');

    await new GitLabMirror(context).run(baseConfig());

    expect(git.clones).toHaveLength(0);
    expect(git.updates).toEqual(['/backups/mirrors/hello.git']);
    expect(git.pushes).toHaveLength(1);
  });

  it('self-heals protected branches that block force pushes', async () => {
    setHappyPathResponses('protected-repo');
    setProjectExists('protected-repo', 123);

    http.setResponse('GET', 'https://gitlab.com/api/v4/projects/123/protected_branches', {
      statusCode: 200,
      body: JSON.stringify([
        { name: 'master', allow_force_push: false },
        { name: 'release', allow_force_push: true },
      ]),
    });
    http.setResponse('PATCH', 'https://gitlab.com/api/v4/projects/123/protected_branches/master', {
      statusCode: 200,
      body: JSON.stringify({ name: 'master', allow_force_push: true }),
    });

    git.throwOnUrl = 'https://oauth2:gl-token@gitlab.com/octocat/protected-repo.git';

    await new GitLabMirror(context).run(baseConfig());

    expect(git.pushes).toHaveLength(1);
    const patches = http.requests.filter((request) => request.method === 'PATCH');
    expect(patches).toHaveLength(2);
    const allowUrl = 'https://gitlab.com/api/v4/projects/123/protected_branches/master';
    expect(patches[0].url).toBe(allowUrl);
    expect(patches[1].url).toBe(allowUrl);
    expect(logger.messages.some((m) => m.message.includes('temporarily allowing force push'))).toBe(
      true,
    );
    expect(
      logger.messages.filter((m) =>
        m.message.includes('Backed up to GitLab: octocat/protected-repo'),
      ),
    ).toHaveLength(1);
  });

  it('fails the repo when protected branches cannot be healed', async () => {
    setHappyPathResponses('blocked');
    setProjectExists('blocked', 123);

    http.setResponse('GET', 'https://gitlab.com/api/v4/projects/123/protected_branches', {
      statusCode: 403,
      body: JSON.stringify({ message: '403 Forbidden' }),
    });

    git.throwOnUrl = 'https://oauth2:gl-token@gitlab.com/octocat/blocked.git';

    await new GitLabMirror(context).run(baseConfig());

    expect(git.pushes).toHaveLength(0);
    expect(
      logger.messages.some((m) =>
        m.message.includes('Failed to push mirror to GitLab for blocked'),
      ),
    ).toBe(true);

    process.exitCode = undefined;
  });
  it('creates missing GitLab projects when auto-create is enabled', async () => {
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
            full_name: 'octocat/newrepo',
            name: 'newrepo',
            clone_url: 'https://github.com/octocat/newrepo.git',
            ssh_url: 'git@github.com:octocat/newrepo.git',
            archived: false,
          },
        ]),
      },
    );

    http.setResponse('GET', 'https://gitlab.com/api/v4/namespaces?search=octocat', {
      statusCode: 200,
      body: JSON.stringify([{ id: 42, full_path: 'octocat' }]),
    });

    http.setResponse('GET', 'https://gitlab.com/api/v4/projects/octocat%2Fnewrepo', {
      statusCode: 200,
      body: JSON.stringify({ message: '404 Project Not Found' }),
    });

    http.setResponse('POST', 'https://gitlab.com/api/v4/projects', {
      statusCode: 201,
      body: JSON.stringify({ id: 789 }),
    });

    const config: GitLabMirrorConfig = {
      githubToken: 'gh-token',
      githubUsername: undefined,
      useSsh: false,
      gitlabToken: 'gl-token',
      gitlabNamespace: 'octocat',
      autoCreateProjects: true,
      gitlabVisibility: 'private',
      gitlabHost: 'https://gitlab.com',
      backupRoot: '/backups',
    };

    await new GitLabMirror(context).run(config);

    expect(logger.messages.some((m) => m.message.includes('Created GitLab project'))).toBe(true);
  });

  it('skips push when auto-create is disabled and project is missing', async () => {
    http.setResponse(
      'GET',
      'https://api.github.com/users/octocat/repos?page=1&per_page=100&type=all&sort=updated',
      {
        statusCode: 200,
        body: JSON.stringify([
          {
            full_name: 'octocat/missing',
            name: 'missing',
            clone_url: 'https://github.com/octocat/missing.git',
            ssh_url: 'git@github.com:octocat/missing.git',
            archived: false,
          },
        ]),
      },
    );

    http.setResponse('GET', 'https://gitlab.com/api/v4/projects/octocat%2Fmissing', {
      statusCode: 200,
      body: JSON.stringify({ message: '404 Project Not Found' }),
    });

    const config: GitLabMirrorConfig = {
      githubToken: undefined,
      githubUsername: 'octocat',
      useSsh: false,
      gitlabToken: 'gl-token',
      gitlabNamespace: 'octocat',
      autoCreateProjects: false,
      gitlabVisibility: 'private',
      gitlabHost: 'https://gitlab.com',
      backupRoot: '/backups',
    };

    await new GitLabMirror(context).run(config);

    expect(git.pushes).toHaveLength(0);
    expect(logger.messages.some((m) => m.message.includes('auto-create disabled'))).toBe(true);
  });
});
