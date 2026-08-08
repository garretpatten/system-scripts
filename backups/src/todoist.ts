import { HttpClient, Logger } from './types.js';

export interface TodoistClient {
  fetchTasks(): Promise<unknown[]>;
  fetchProjects(): Promise<unknown[]>;
  fetchLabels(): Promise<unknown[]>;
}

export class TodoistApiClient implements TodoistClient {
  private readonly apiUrl = 'https://api.todoist.com/api/v1';

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly token: string,
  ) {}

  async fetchTasks(): Promise<unknown[]> {
    return this.fetchPagedCollection('/tasks');
  }

  async fetchProjects(): Promise<unknown[]> {
    return this.fetchPagedCollection('/projects');
  }

  async fetchLabels(): Promise<unknown[]> {
    return this.fetchPagedCollection('/labels');
  }

  private async fetchPagedCollection(endpoint: string): Promise<unknown[]> {
    const limit = 200;
    const results: unknown[] = [];
    let cursor: string | null = null;

    while (true) {
      const query = cursor
        ? `${endpoint}?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
        : `${endpoint}?limit=${limit}`;
      const response = await this.apiGet(query);
      const page = this.parsePage(response.body);

      results.push(...page.results);

      if (page.nextCursor === null || page.nextCursor === undefined) {
        break;
      }

      cursor = page.nextCursor;
    }

    return results;
  }

  private async apiGet(path: string) {
    return this.http.get(`${this.apiUrl}${path}`, {
      Authorization: `Bearer ${this.token}`,
    });
  }

  private parsePage(text: string): { results: unknown[]; nextCursor: string | null } {
    const body = this.parseJson(text);
    if (Array.isArray(body)) {
      return { results: body, nextCursor: null };
    }
    if (body.error || body.message) {
      throw new Error(`Todoist API error: ${String(body.error || body.message)}`);
    }
    if (!Array.isArray(body.results)) {
      throw new Error('Todoist API returned non-array results');
    }
    return {
      results: body.results as unknown[],
      nextCursor: (body.next_cursor as string | null | undefined) ?? null,
    };
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
