import { HttpClient, Logger } from './types.js';

export interface TodoistClient {
  fetchTasks(): Promise<unknown[]>;
  fetchProjects(): Promise<unknown[]>;
  fetchLabels(): Promise<unknown[]>;
}

export class TodoistApiClient implements TodoistClient {
  private readonly apiUrl = 'https://api.todoist.com/rest/v2';

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly token: string
  ) {}

  async fetchTasks(): Promise<unknown[]> {
    return this.fetchPagedCollection('/tasks');
  }

  async fetchProjects(): Promise<unknown[]> {
    const response = await this.apiGet('/projects');
    return this.parseArray(response.body);
  }

  async fetchLabels(): Promise<unknown[]> {
    const response = await this.apiGet('/labels');
    return this.parseArray(response.body);
  }

  private async fetchPagedCollection(endpoint: string): Promise<unknown[]> {
    const limit = 200;
    let offset = 0;
    const results: unknown[] = [];

    while (true) {
      const response = await this.apiGet(`${endpoint}?limit=${limit}&offset=${offset}`);
      const page = this.parseArray(response.body);

      if (page.length === 0) {
        break;
      }

      results.push(...page);

      if (page.length < limit) {
        break;
      }

      offset += limit;
    }

    return results;
  }

  private async apiGet(path: string) {
    return this.http.get(`${this.apiUrl}${path}`, {
      Authorization: `Bearer ${this.token}`,
    });
  }

  private parseArray(text: string): unknown[] {
    const body = this.parseJson(text);
    if (Array.isArray(body)) {
      return body;
    }
    if (body.message || body.error) {
      throw new Error(`Todoist API error: ${String(body.message || body.error)}`);
    }
    throw new Error('Todoist API returned non-array response');
  }

  private parseJson(text: string): Record<string, unknown> | unknown[] {
    try {
      return JSON.parse(text) as Record<string, unknown> | unknown[];
    } catch {
      this.logger.error('Invalid JSON response from Todoist API');
      return {};
    }
  }
}
