import { GoogleAuth } from './google-auth.js';
import { HttpClient, Logger } from './types.js';

export interface GoogleCalendarClient {
  fetchCalendars(): Promise<unknown[]>;
  fetchEvents(calendarId: string, options: { showDeleted: boolean }): Promise<unknown[]>;
}

export class GoogleCalendarApiClient implements GoogleCalendarClient {
  private readonly apiUrl = 'https://www.googleapis.com/calendar/v3';

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly auth: GoogleAuth,
  ) {}

  async fetchCalendars(): Promise<unknown[]> {
    return this.fetchPagedCollection('/users/me/calendarList', { maxResults: '250' });
  }

  async fetchEvents(calendarId: string, options: { showDeleted: boolean }): Promise<unknown[]> {
    const params: Record<string, string> = {
      maxResults: '2500',
      singleEvents: 'true',
      orderBy: 'startTime',
    };
    if (options.showDeleted) {
      params.showDeleted = 'true';
    }
    return this.fetchPagedCollection(`/calendars/${encodeURIComponent(calendarId)}/events`, params);
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
      throw new Error(`Google Calendar API error: ${detail}`);
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
      this.logger.error('Invalid JSON response from Google Calendar API');
      return {};
    }
  }
}
