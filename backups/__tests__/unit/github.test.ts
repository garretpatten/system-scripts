import { GitHubApiClient } from '../../src/github.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

describe('GitHubApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: GitHubApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new GitHubApiClient(http, logger);
  });

  describe('getAuthenticatedUser', () => {
    it('returns the login from the GitHub /user response', async () => {
      http.setResponse('GET', 'https://api.github.com/user', {
        statusCode: 200,
        body: JSON.stringify({ login: 'octocat' }),
      });

      const user = await client.getAuthenticatedUser('token123');

      expect(user.login).toBe('octocat');
      expect(http.requests[0].headers).toEqual({ Authorization: 'token token123' });
    });

    it('throws when token is missing', async () => {
      await expect(client.getAuthenticatedUser()).rejects.toThrow(
        'GitHub token is required to detect username'
      );
    });

    it('throws when login is missing', async () => {
      http.setResponse('GET', 'https://api.github.com/user', {
        statusCode: 200,
        body: JSON.stringify({}),
      });

      await expect(client.getAuthenticatedUser('token123')).rejects.toThrow(
        'Could not detect GitHub username from token'
      );
    });
  });

  describe('listRepos', () => {
    it('lists non-archived repos for a user', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/users/octocat/repos?page=1&per_page=100&type=all&sort=updated',
        {
          statusCode: 200,
          body: JSON.stringify([
            { full_name: 'octocat/hello', name: 'hello', clone_url: 'https://github.com/octocat/hello.git', ssh_url: 'git@github.com:octocat/hello.git', archived: false },
            { full_name: 'octocat/archived', name: 'archived', clone_url: 'https://github.com/octocat/archived.git', ssh_url: 'git@github.com:octocat/archived.git', archived: true },
          ]),
        }
      );

      const repos = [];
      for await (const repo of client.listRepos('octocat')) {
        repos.push(repo);
      }

      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe('hello');
      expect(repos[0].fullName).toBe('octocat/hello');
    });

    it('uses the authenticated endpoint when a token is provided', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/user/repos?page=1&per_page=100&type=all&sort=updated',
        {
          statusCode: 200,
          body: JSON.stringify([
            { full_name: 'octocat/private', name: 'private', clone_url: 'https://github.com/octocat/private.git', ssh_url: 'git@github.com:octocat/private.git', archived: false },
          ]),
        }
      );

      const repos = [];
      for await (const repo of client.listRepos('octocat', 'token123')) {
        repos.push(repo);
      }

      expect(repos).toHaveLength(1);
      expect(http.requests[0].headers).toEqual({ Authorization: 'token token123' });
    });

    it('paginates until fewer than per_page repos are returned', async () => {
      for (let page = 1; page <= 2; page++) {
        http.setResponse(
          'GET',
          `https://api.github.com/users/octocat/repos?page=${page}&per_page=100&type=all&sort=updated`,
          {
            statusCode: 200,
            body: JSON.stringify(
              page === 1
                ? Array.from({ length: 100 }, (_, i) => ({
                    full_name: `octocat/repo${i}`,
                    name: `repo${i}`,
                    clone_url: `https://github.com/octocat/repo${i}.git`,
                    ssh_url: `git@github.com:octocat/repo${i}.git`,
                    archived: false,
                  }))
                : [{ full_name: 'octocat/last', name: 'last', clone_url: 'https://github.com/octocat/last.git', ssh_url: 'git@github.com:octocat/last.git', archived: false }]
            ),
          }
        );
      }

      const repos = [];
      for await (const repo of client.listRepos('octocat')) {
        repos.push(repo);
      }

      expect(repos).toHaveLength(101);
    });

    it('throws on API error messages', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/users/octocat/repos?page=1&per_page=100&type=all&sort=updated',
        {
          statusCode: 200,
          body: JSON.stringify({ message: 'Bad credentials' }),
        }
      );

      const generator = client.listRepos('octocat');
      await expect(generator.next()).rejects.toThrow('GitHub API error: Bad credentials');
    });
  });

  describe('listAllRepos', () => {
    it('includes archived repos', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/users/octocat/repos?page=1&per_page=100&type=all&sort=updated',
        {
          statusCode: 200,
          body: JSON.stringify([
            { full_name: 'octocat/hello', name: 'hello', clone_url: 'https://github.com/octocat/hello.git', ssh_url: 'git@github.com:octocat/hello.git', archived: false },
            { full_name: 'octocat/archived', name: 'archived', clone_url: 'https://github.com/octocat/archived.git', ssh_url: 'git@github.com:octocat/archived.git', archived: true },
          ]),
        }
      );

      const repos = [];
      for await (const repo of client.listAllRepos('octocat')) {
        repos.push(repo);
      }

      expect(repos).toHaveLength(2);
      expect(repos[0].name).toBe('hello');
      expect(repos[0].archived).toBe(false);
      expect(repos[1].name).toBe('archived');
      expect(repos[1].archived).toBe(true);
    });
  });
});
