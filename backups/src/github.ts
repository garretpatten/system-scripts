import { GitHubRepo, HttpClient, Logger } from './types.js';

export interface GitHubClient {
  getAuthenticatedUser(token?: string): Promise<{ login: string }>;
  listRepos(username: string, token?: string): AsyncGenerator<GitHubRepo, void, unknown>;
  listAllRepos(username: string, token?: string): AsyncGenerator<GitHubRepo, void, unknown>;
}

export class GitHubApiClient implements GitHubClient {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger
  ) {}

  async getAuthenticatedUser(token?: string): Promise<{ login: string }> {
    if (!token) {
      throw new Error('GitHub token is required to detect username');
    }
    const response = await this.http.get('https://api.github.com/user', {
      Authorization: `token ${token}`,
    });
    const body = this.parseObject(response.body);
    if (!body.login) {
      throw new Error('Could not detect GitHub username from token');
    }
    return { login: String(body.login) };
  }

  async *listRepos(username: string, token?: string): AsyncGenerator<GitHubRepo, void, unknown> {
    for await (const repo of this.fetchRepos(username, token, false)) {
      yield repo;
    }
  }

  async *listAllRepos(username: string, token?: string): AsyncGenerator<GitHubRepo, void, unknown> {
    for await (const repo of this.fetchRepos(username, token, true)) {
      yield repo;
    }
  }

  private async *fetchRepos(
    username: string,
    token: string | undefined,
    includeArchived: boolean,
  ): AsyncGenerator<GitHubRepo, void, unknown> {
    const perPage = 100;
    let page = 1;

    while (true) {
      let url: string;
      const headers: Record<string, string> = {};

      if (token) {
        url = `https://api.github.com/user/repos?page=${page}&per_page=${perPage}&type=all&sort=updated`;
        headers.Authorization = `token ${token}`;
      } else {
        url = `https://api.github.com/users/${encodeURIComponent(username)}/repos?page=${page}&per_page=${perPage}&type=all&sort=updated`;
      }

      const response = await this.http.get(url, headers);
      const parsed = this.parseJson(response.body);

      if (!Array.isArray(parsed)) {
        if (parsed.message) {
          throw new Error(`GitHub API error: ${parsed.message}`);
        }
        break;
      }

      if (parsed.length === 0) {
        break;
      }

      const repos: GitHubRepo[] = parsed
        .filter((repo) => includeArchived || (repo as Record<string, unknown>).archived === false)
        .map((repo) => ({
          fullName: String((repo as Record<string, unknown>).full_name),
          name: String((repo as Record<string, unknown>).name),
          cloneUrl: String((repo as Record<string, unknown>).clone_url),
          sshUrl: String((repo as Record<string, unknown>).ssh_url),
          archived: (repo as Record<string, unknown>).archived === true,
        }));

      for (const repo of repos) {
        yield repo;
      }

      if (parsed.length < perPage) {
        break;
      }

      page++;
    }
  }

  private parseObject(text: string): Record<string, unknown> {
    const parsed = this.parseJson(text);
    if (Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  }

  private parseJson(text: string): Record<string, unknown> | unknown[] {
    try {
      return JSON.parse(text) as Record<string, unknown> | unknown[];
    } catch {
      this.logger.error('Invalid JSON response from GitHub API');
      return {};
    }
  }
}
