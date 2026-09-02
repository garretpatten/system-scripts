import { GitLabMirrorCleanup, GitLabMirrorCleanupConfig } from '../../src/gitlab-mirror-cleanup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

describe('GitLabMirrorCleanup', () => {
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

    runner.setResponse('git', ['--version'], { stdout: 'git version 2.0', stderr: '', exitCode: 0 });
    runner.setResponse('curl', ['--version'], { stdout: 'curl 8.0', stderr: '', exitCode: 0 });
  });

  const baseConfig: GitLabMirrorCleanupConfig = {
    githubToken: 'gh-token',
    githubUsername: undefined,
    gitlabToken: 'gl-token',
    gitlabNamespace: 'octocat',
    gitlabHost: 'https://gitlab.com',
    backupRoot: '/backups',
  };

  const mockGithubUser = () => {
    http.setResponse('GET', 'https://api.github.com/user', {
      statusCode: 200,
      body: JSON.stringify({ login: 'octocat' }),
    });
  };

  const mockGithubRepos = (repos: unknown[]) => {
    http.setResponse(
      'GET',
      'https://api.github.com/user/repos?page=1&per_page=100&type=all&sort=updated',
      {
        statusCode: 200,
        body: JSON.stringify(repos),
      }
    );
  };

  const mockGitlabNamespace = () => {
    http.setResponse('GET', 'https://gitlab.com/api/v4/namespaces?search=octocat', {
      statusCode: 200,
      body: JSON.stringify([{ id: 42, full_path: 'octocat' }]),
    });
  };

  const mockGitlabProjects = (projects: unknown[]) => {
    http.setResponse(
      'GET',
      'https://gitlab.com/api/v4/projects?namespace_id=42&per_page=100&page=1',
      {
        statusCode: 200,
        body: JSON.stringify(projects),
      }
    );
  };

  it('keeps mirrors of active GitHub repos', async () => {
    mockGithubUser();
    mockGithubRepos([
      { full_name: 'octocat/hello', name: 'hello', archived: false },
    ]);
    mockGitlabNamespace();
    mockGitlabProjects([{ id: 1, path_with_namespace: 'octocat/hello' }]);

    await new GitLabMirrorCleanup(context).run(baseConfig);

    expect(logger.messages.some((m) => m.message.includes('Keeping mirror: octocat/hello'))).toBe(
      true
    );
    expect(http.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
  });

  it('deletes mirrors of archived GitHub repos', async () => {
    mockGithubUser();
    mockGithubRepos([
      { full_name: 'octocat/hello', name: 'hello', archived: false },
      { full_name: 'octocat/archived', name: 'archived', archived: true },
    ]);
    mockGitlabNamespace();
    mockGitlabProjects([
      { id: 1, path_with_namespace: 'octocat/hello' },
      { id: 2, path_with_namespace: 'octocat/archived' },
    ]);

    http.setResponse('DELETE', 'https://gitlab.com/api/v4/projects/2', {
      statusCode: 202,
      body: JSON.stringify({ message: '202 Accepted' }),
    });

    await new GitLabMirrorCleanup(context).run(baseConfig);

    expect(logger.messages.some((m) => m.message.includes('Deleting mirror (archived on GitHub): octocat/archived'))).toBe(true);
    expect(http.requests.some((r) => r.method === 'DELETE' && r.url === 'https://gitlab.com/api/v4/projects/2')).toBe(true);
  });

  it('deletes mirrors with no matching GitHub repo', async () => {
    mockGithubUser();
    mockGithubRepos([
      { full_name: 'octocat/hello', name: 'hello', archived: false },
    ]);
    mockGitlabNamespace();
    mockGitlabProjects([
      { id: 1, path_with_namespace: 'octocat/hello' },
      { id: 3, path_with_namespace: 'octocat/deleted' },
    ]);

    http.setResponse('DELETE', 'https://gitlab.com/api/v4/projects/3', {
      statusCode: 202,
      body: JSON.stringify({ message: '202 Accepted' }),
    });

    await new GitLabMirrorCleanup(context).run(baseConfig);

    expect(logger.messages.some((m) => m.message.includes('Deleting mirror (no matching GitHub repo): octocat/deleted'))).toBe(true);
    expect(http.requests.some((r) => r.method === 'DELETE' && r.url === 'https://gitlab.com/api/v4/projects/3')).toBe(true);
  });

  it('skips cleanup when no GitHub repos are found', async () => {
    mockGithubUser();
    mockGithubRepos([]);

    await new GitLabMirrorCleanup(context).run(baseConfig);

    expect(logger.messages.some((m) => m.message.includes('No GitHub repos found'))).toBe(true);
    expect(http.requests.filter((r) => r.method === 'GET' && r.url.includes('/namespaces'))).toHaveLength(0);
  });

  it('sets exit code when deletions fail', async () => {
    mockGithubUser();
    mockGithubRepos([
      { full_name: 'octocat/hello', name: 'hello', archived: false },
    ]);
    mockGitlabNamespace();
    mockGitlabProjects([{ id: 5, path_with_namespace: 'octocat/deleted' }]);

    http.setResponse('DELETE', 'https://gitlab.com/api/v4/projects/5', {
      statusCode: 403,
      body: JSON.stringify({ message: 'Forbidden' }),
    });

    await new GitLabMirrorCleanup(context).run(baseConfig);

    expect(process.exitCode).toBe(1);
    expect(logger.messages.some((m) => m.message.includes('Failed to delete GitLab project'))).toBe(true);

    process.exitCode = undefined;
  });
});
