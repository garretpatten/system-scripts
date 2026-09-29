import { GitHubAlertsClient } from '../../src/alerts.js';
import { MockHttpClient, MockLogger } from '../../../backups/__tests__/test-helpers.js';

describe('GitHubAlertsClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: GitHubAlertsClient;
  const tokenHeaders = {
    Authorization: 'token gh-token',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new GitHubAlertsClient(http, logger, 'gh-token');
  });

  describe('listOwnedRepos', () => {
    it('lists repos owned by the authenticated user', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/user/repos?per_page=100&page=1&type=owner&sort=full_name',
        {
          statusCode: 200,
          body: JSON.stringify([
            {
              full_name: 'garretpatten/hello',
              name: 'hello',
              html_url: 'https://github.com/garretpatten/hello',
              archived: false,
              private: true,
            },
          ]),
        },
      );

      const repos = [];
      for await (const repo of client.listOwnedRepos()) {
        repos.push(repo);
      }

      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe('hello');
      expect(repos[0].fullName).toBe('garretpatten/hello');
      expect(repos[0].htmlUrl).toBe('https://github.com/garretpatten/hello');
      expect(repos[0].isPrivate).toBe(true);
      expect(repos[0].archived).toBe(false);
      expect(http.requests[0].headers).toEqual(tokenHeaders);
    });

    it('paginates until fewer than per_page repos are returned', async () => {
      for (let page = 1; page <= 2; page++) {
        http.setResponse(
          'GET',
          `https://api.github.com/user/repos?per_page=100&page=${page}&type=owner&sort=full_name`,
          {
            statusCode: 200,
            body: JSON.stringify(
              page === 1
                ? Array.from({ length: 100 }, (_, i) => ({
                    full_name: `garretpatten/repo${i}`,
                    name: `repo${i}`,
                    html_url: `https://github.com/garretpatten/repo${i}`,
                    archived: false,
                    private: false,
                  }))
                : [],
            ),
          },
        );
      }

      const repos = [];
      for await (const repo of client.listOwnedRepos()) {
        repos.push(repo);
      }

      expect(repos).toHaveLength(100);
    });

    it('throws when the API returns an error message', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/user/repos?per_page=100&page=1&type=owner&sort=full_name',
        {
          statusCode: 200,
          body: JSON.stringify({ message: 'Bad credentials' }),
        },
      );

      const generator = client.listOwnedRepos();
      await expect(generator.next()).rejects.toThrow('Bad credentials');
    });
  });

  describe('listDependabotAlerts', () => {
    it('maps dependabot alerts with cursor pagination via the Link header', async () => {
      const firstUrl =
        'https://api.github.com/repos/garretpatten/api/dependabot/alerts?state=open&per_page=100';
      const secondUrl =
        'https://api.github.com/repos/garretpatten/api/dependabot/alerts?state=open&per_page=100&after=curo2';

      http.setResponse('GET', firstUrl, {
        statusCode: 200,
        body: JSON.stringify([
          {
            number: 12,
            state: 'open',
            dependency: {
              package: { ecosystem: 'npm', name: 'lodash' },
              manifest_path: 'package-lock.json',
            },
            security_advisory: {
              ghsa_id: 'GHSA-abcd-abcd-abcd',
              cve_id: 'CVE-2020-8203',
              summary: 'Prototype pollution in lodash',
              severity: 'high',
            },
            security_vulnerability: {
              severity: 'high',
              vulnerable_version_range: '< 4.17.21',
              first_patched_version: { identifier: '4.17.21' },
            },
            created_at: '2020-08-15T12:00:00Z',
            html_url: 'https://github.com/garretpatten/api/security/dependabot/12',
          },
        ]),
        headers: { link: `<${secondUrl}>; rel="next"` },
      });
      http.setResponse('GET', secondUrl, {
        statusCode: 200,
        body: JSON.stringify([]),
      });

      const alerts = await client.listDependabotAlerts('garretpatten/api');

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toEqual({
        number: 12,
        state: 'open',
        severity: 'high',
        ecosystem: 'npm',
        packageName: 'lodash',
        manifestPath: 'package-lock.json',
        ghsaId: 'GHSA-abcd-abcd-abcd',
        cveId: 'CVE-2020-8203',
        summary: 'Prototype pollution in lodash',
        vulnerableRange: '< 4.17.21',
        patchedVersion: '4.17.21',
        createdAt: '2020-08-15T12:00:00Z',
        url: 'https://github.com/garretpatten/api/security/dependabot/12',
      });
      expect(http.requests.map((request) => request.url)).toEqual([firstUrl, secondUrl]);
    });

    it('stops without a link header', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/repos/garretpatten/api/dependabot/alerts?state=open&per_page=100',
        {
          statusCode: 200,
          body: JSON.stringify([]),
        },
      );

      const alerts = await client.listDependabotAlerts('garretpatten/api');

      expect(alerts).toHaveLength(0);
      expect(http.requests).toHaveLength(1);
    });

    it('encodes owner and repo path segments', async () => {
      http.setResponse(
        'GET',
        'https://api.github.com/repos/garretpatten/some%20repo/dependabot/alerts?state=open&per_page=100',
        {
          statusCode: 200,
          body: JSON.stringify([]),
        },
      );

      const alerts = await client.listDependabotAlerts('garretpatten/some repo');

      expect(alerts).toHaveLength(0);
    });
  });

  describe('listCodeScanningAlerts', () => {
    it('maps code scanning alerts and paginates with page params', async () => {
      const firstUrl =
        'https://api.github.com/repos/garretpatten/api/code-scanning/alerts?state=open&per_page=100&page=1';
      const secondUrl =
        'https://api.github.com/repos/garretpatten/api/code-scanning/alerts?state=open&per_page=100&page=2';

      http.setResponse('GET', firstUrl, {
        statusCode: 200,
        body: JSON.stringify(
          Array.from({ length: 100 }, (_, i) => ({
            number: i,
            state: 'open',
            rule: {
              id: 'js/xss',
              description: 'Cross-site scripting',
              security_severity_level: 'high',
            },
            tool: { name: 'CodeQL' },
            most_recent_instance: { location: { path: 'src/app.ts', start_line: 42 } },
            created_at: '2025-02-01T00:00:00Z',
            html_url: 'https://github.com/garretpatten/api/security/code-scanning/' + i,
          })),
        ),
      });
      http.setResponse('GET', secondUrl, {
        statusCode: 200,
        body: JSON.stringify([
          {
            number: 200,
            state: 'open',
            rule: { id: 'js/hardcoded-secret', description: 'Hardcoded secret' },
            tool: { name: 'CodeQL' },
            most_recent_instance: { location: { path: 'src/config.ts' } },
            html_url: 'https://github.com/garretpatten/api/security/code-scanning/200',
          },
        ]),
      });

      const alerts = await client.listCodeScanningAlerts('garretpatten/api');

      expect(alerts).toHaveLength(101);
      expect(alerts[0].severity).toBe('high');
      expect(alerts[0].tool).toBe('CodeQL');
      expect(alerts[0].startLine).toBe(42);
      expect(alerts[100].ruleId).toBe('js/hardcoded-secret');
      expect(alerts[100].severity).toBe('unknown');
      expect(alerts[100].startLine).toBeNull();
      expect(http.requests.map((request) => request.url)).toEqual([firstUrl, secondUrl]);
    });
  });

  describe('getAuthenticatedLogin', () => {
    it('returns the login from the /user response', async () => {
      http.setResponse('GET', 'https://api.github.com/user', {
        statusCode: 200,
        body: JSON.stringify({ login: 'garretpatten' }),
      });

      const login = await client.getAuthenticatedLogin();

      expect(login).toBe('garretpatten');
      expect(http.requests[0].headers).toEqual(tokenHeaders);
    });

    it('throws when the login is missing', async () => {
      http.setResponse('GET', 'https://api.github.com/user', {
        statusCode: 200,
        body: JSON.stringify({}),
      });

      await expect(client.getAuthenticatedLogin()).rejects.toThrow(
        'Could not detect GitHub username from token',
      );
    });
  });
});
