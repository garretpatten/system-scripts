import { HttpClient, Logger } from './types.js';

export interface NotionClient {
  searchAll(): AsyncGenerator<Record<string, unknown>, void, unknown>;
  queryDatabase(databaseId: string): AsyncGenerator<Record<string, unknown>, void, unknown>;
  getBlockChildren(blockId: string, startCursor?: string): Promise<Record<string, unknown>>;
  getDatabase(databaseId: string): Promise<Record<string, unknown>>;
}

export interface NotionObject {
  id: string;
  object: 'page' | 'database';
  title: string;
  parentId: string | null;
}

export class NotionApiClient implements NotionClient {
  private readonly apiUrl = 'https://api.notion.com/v1';

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly token: string,
    private readonly version: string,
    private readonly rateLimitDelayMs: number,
  ) {}

  async *searchAll(): AsyncGenerator<Record<string, unknown>, void, unknown> {
    let cursor: string | undefined;

    while (true) {
      const payload = cursor
        ? JSON.stringify({ page_size: 100, start_cursor: cursor })
        : JSON.stringify({ page_size: 100 });

      const response = await this.apiPost('/search', payload);
      const body = this.parseJson(response.body);

      if (body.message || body.status) {
        throw new Error(`Notion API error on /search: ${String(body.message || body.status)}`);
      }

      const results = Array.isArray(body.results) ? body.results : [];
      for (const result of results) {
        if (typeof result === 'object' && result !== null) {
          yield result as Record<string, unknown>;
        }
      }

      cursor = body.next_cursor as string | undefined;
      if (!cursor) break;
    }
  }

  async *queryDatabase(databaseId: string): AsyncGenerator<Record<string, unknown>, void, unknown> {
    let cursor: string | undefined;

    while (true) {
      const payload = cursor
        ? JSON.stringify({ page_size: 100, start_cursor: cursor })
        : JSON.stringify({ page_size: 100 });

      const response = await this.apiPost(`/databases/${databaseId}/query`, payload);
      const body = this.parseJson(response.body);

      // Throw instead of silently returning: an empty database export that
      // masks a failed query reads as a successful backup.
      if (response.statusCode >= 400) {
        const detail = body.message || body.status || `HTTP ${response.statusCode}`;
        throw new Error(`Notion API error on /databases/${databaseId}/query: ${String(detail)}`);
      }

      const results = Array.isArray(body.results) ? body.results : [];
      for (const result of results) {
        if (typeof result === 'object' && result !== null) {
          yield result as Record<string, unknown>;
        }
      }

      cursor = body.next_cursor as string | undefined;
      if (!cursor) break;
    }
  }

  async getBlockChildren(blockId: string, startCursor?: string): Promise<Record<string, unknown>> {
    let path = `/blocks/${blockId}/children`;
    if (startCursor) {
      path += `?start_cursor=${encodeURIComponent(startCursor)}`;
    }
    const response = await this.apiGet(path);
    const body = this.parseJson(response.body);

    // Throw instead of silently returning an error body: a page export
    // built from it would read as a successful backup.
    if (response.statusCode >= 400) {
      const detail = body.message || body.status || `HTTP ${response.statusCode}`;
      throw new Error(`Notion API error on /blocks/${blockId}/children: ${String(detail)}`);
    }

    return body;
  }

  async getDatabase(databaseId: string): Promise<Record<string, unknown>> {
    const response = await this.apiGet(`/databases/${databaseId}`);
    const body = this.parseJson(response.body);

    if (response.statusCode >= 400) {
      const detail = body.message || body.status || `HTTP ${response.statusCode}`;
      throw new Error(`Notion API error on /databases/${databaseId}: ${String(detail)}`);
    }

    return body;
  }

  private async apiGet(path: string) {
    await this.sleep();
    return this.http.get(`${this.apiUrl}${path}`, this.headers());
  }

  private async apiPost(path: string, payload: string) {
    await this.sleep();
    return this.http.post(`${this.apiUrl}${path}`, payload, {
      ...this.headers(),
      'Content-Type': 'application/json',
    });
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Notion-Version': this.version,
    };
  }

  private async sleep(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.rateLimitDelayMs));
  }

  private parseJson(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.error('Invalid JSON response from Notion API');
      return {};
    }
  }
}
