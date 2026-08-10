import { GoogleAuth } from './google-auth.js';
import { HttpClient, Logger } from './types.js';

export interface GoogleTasksClient {
  fetchTaskLists(): Promise<unknown[]>;
  fetchTasks(
    taskListId: string,
    options: { showCompleted: boolean; showDeleted: boolean; showHidden: boolean },
  ): Promise<unknown[]>;
}

export class GoogleTasksApiClient implements GoogleTasksClient {
  private readonly apiUrl = 'https://tasks.googleapis.com/tasks/v1';

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly auth: GoogleAuth,
  ) {}

  async fetchTaskLists(): Promise<unknown[]> {
    return this.fetchPagedCollection('/users/@me/lists', { maxResults: '1000' });
  }

  async fetchTasks(
    taskListId: string,
    options: { showCompleted: boolean; showDeleted: boolean; showHidden: boolean },
  ): Promise<unknown[]> {
    return this.fetchPagedCollection(`/lists/${encodeURIComponent(taskListId)}/tasks`, {
      maxResults: '100',
      showCompleted: String(options.showCompleted),
      showDeleted: String(options.showDeleted),
      showHidden: String(options.showHidden),
    });
  }

  private async fetchPagedCollection(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let pageToken: string | null = null;

    while (true) {
      const query = new URLSearchParams(params);
      if (pageToken) {
        query.set('pageToken', pageToken);
      }
      const response = await this.apiGet(`${endpoint}?${query.toString()}`);
      const page = this.parsePage(response.body, response.statusCode);

      results.push(...page.items);

      if (page.nextPageToken === null) {
        break;
      }

      pageToken = page.nextPageToken;
    }

    return results;
  }

  private async apiGet(path: string) {
    const token = await this.auth.getAccessToken();
    return this.http.get(`${this.apiUrl}${path}`, {
      Authorization: `Bearer ${token}`,
    });
  }

  private parsePage(
    text: string,
    statusCode: number,
  ): { items: unknown[]; nextPageToken: string | null } {
    const body = this.parseJson(text);
    if (statusCode >= 400 || body.error) {
      const detail =
        body.error && typeof body.error === 'object'
          ? String((body.error as Record<string, unknown>).message || 'Unknown error')
          : String(body.message || `HTTP ${statusCode}`);
      throw new Error(`Google Tasks API error: ${detail}`);
    }
    const items = Array.isArray(body.items) ? (body.items as unknown[]) : [];
    return {
      items,
      nextPageToken: (body.nextPageToken as string | null | undefined) ?? null,
    };
  }

  private parseJson(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.error('Invalid JSON response from Google Tasks API');
      return {};
    }
  }
}
