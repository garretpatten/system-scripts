import { GitLabProject, HttpClient, Logger } from './types.js';

export interface GitLabClient {
  getNamespaceId(namespace: string): Promise<number>;
  projectExists(pathWithNamespace: string): Promise<boolean>;
  createProject(name: string, namespaceId: number, visibility: string): Promise<void>;
  deleteProject(projectId: number): Promise<void>;
  listProjects(namespaceId: number): AsyncGenerator<GitLabProject, void, unknown>;
  buildRemoteUrl(pathWithNamespace: string): string;
}

export class GitLabApiClient implements GitLabClient {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly host: string,
    private readonly token: string
  ) {}

  private get apiUrl(): string {
    return `${this.host}/api/v4`;
  }

  private headers(): Record<string, string> {
    return { 'PRIVATE-TOKEN': this.token };
  }

  async getNamespaceId(namespace: string): Promise<number> {
    const encoded = encodeURIComponent(namespace);
    const response = await this.http.get(
      `${this.apiUrl}/namespaces?search=${encoded}`,
      this.headers()
    );
    const body = this.parseJson(response.body);
    if (!Array.isArray(body)) {
      throw new Error('GitLab namespaces response was not an array');
    }
    const match = body.find(
      (entry: Record<string, unknown>) => entry.full_path === namespace
    ) as Record<string, unknown> | undefined;
    if (!match || typeof match.id !== 'number') {
      throw new Error(`Could not resolve GitLab namespace: ${namespace}`);
    }
    return match.id;
  }

  async projectExists(pathWithNamespace: string): Promise<boolean> {
    const encoded = encodeURIComponent(pathWithNamespace);
    const response = await this.http.get(
      `${this.apiUrl}/projects/${encoded}`,
      this.headers()
    );
    const body = this.parseJson(response.body);
    return typeof body.id === 'number';
  }

  async createProject(
    name: string,
    namespaceId: number,
    visibility: string
  ): Promise<void> {
    const payload = JSON.stringify({
      name,
      namespace_id: namespaceId,
      visibility,
    });
    const response = await this.http.post(`${this.apiUrl}/projects`, payload, {
      ...this.headers(),
      'Content-Type': 'application/json',
    });
    const body = this.parseJson(response.body);
    if (typeof body.id !== 'number') {
      const message =
        (body.message as string | undefined) ||
        (body.error as string | undefined) ||
        'unknown error';
      throw new Error(`GitLab project creation failed for ${name}: ${message}`);
    }
  }

  async deleteProject(projectId: number): Promise<void> {
    const response = await this.http.delete(`${this.apiUrl}/projects/${projectId}`, this.headers());
    if (response.statusCode !== 200 && response.statusCode !== 202 && response.statusCode !== 204) {
      const body = this.parseJson(response.body);
      const message =
        (body.message as string | undefined) ||
        (body.error as string | undefined) ||
        `HTTP ${response.statusCode}`;
      throw new Error(`GitLab project deletion failed for ${projectId}: ${message}`);
    }
  }

  async *listProjects(namespaceId: number): AsyncGenerator<GitLabProject, void, unknown> {
    const perPage = 100;
    let page = 1;

    while (true) {
      const response = await this.http.get(
        `${this.apiUrl}/projects?namespace_id=${namespaceId}&per_page=${perPage}&page=${page}`,
        this.headers()
      );
      const parsed = this.parseJson(response.body);

      if (!Array.isArray(parsed)) {
        if (parsed.message) {
          throw new Error(`GitLab API error: ${parsed.message}`);
        }
        break;
      }

      if (parsed.length === 0) {
        break;
      }

      const projects: GitLabProject[] = parsed.map((project) => ({
        id: Number((project as Record<string, unknown>).id),
        pathWithNamespace: String((project as Record<string, unknown>).path_with_namespace),
      }));

      for (const project of projects) {
        yield project;
      }

      if (parsed.length < perPage) {
        break;
      }

      page++;
    }
  }

  buildRemoteUrl(pathWithNamespace: string): string {
    return `https://oauth2:${this.token}@gitlab.com/${pathWithNamespace}.git`;
  }

  private parseJson(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.error('Invalid JSON response from GitLab API');
      return {};
    }
  }
}
