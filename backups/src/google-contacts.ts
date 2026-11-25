import { GoogleAuth } from './google-auth.js';
import { GoogleApiError } from './google-api-error.js';
import { HttpClient, Logger } from './types.js';

/**
 * Every person field the People API documents for `personFields`. The API
 * rejects `*` as a field mask ("Invalid personFields mask path"), so the
 * full list has to be spelled out.
 */
export const PERSON_FIELDS = [
  'addresses',
  'ageRanges',
  'biographies',
  'birthdays',
  'calendarUrls',
  'clientData',
  'coverPhotos',
  'emailAddresses',
  'events',
  'externalIds',
  'genders',
  'imClients',
  'interests',
  'locales',
  'locations',
  'memberships',
  'metadata',
  'miscKeywords',
  'names',
  'nicknames',
  'occupations',
  'organizations',
  'phoneNumbers',
  'photos',
  'relations',
  'sipAddresses',
  'skills',
  'urls',
  'userDefined',
].join(',');

/**
 * The readMask paths the otherContacts endpoint documents for the
 * READ_SOURCE_TYPE_CONTACT source; `*` is rejected here as well.
 */
export const OTHER_CONTACTS_READ_MASK = [
  'emailAddresses',
  'metadata',
  'names',
  'phoneNumbers',
  'photos',
].join(',');

export interface GoogleContactsClient {
  fetchContacts(): Promise<unknown[]>;
  fetchContactGroups(): Promise<unknown[]>;
  fetchOtherContacts(): Promise<unknown[]>;
}

export class GoogleContactsApiClient implements GoogleContactsClient {
  private readonly apiUrl = 'https://people.googleapis.com/v1';

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly auth: GoogleAuth,
  ) {}

  async fetchContacts(): Promise<unknown[]> {
    // The full documented field list captures everything on each person,
    // including group memberships; the People API documents 1000 as the
    // maximum page size.
    return this.fetchPagedCollection(
      '/people/me/connections',
      {
        personFields: PERSON_FIELDS,
        pageSize: '1000',
      },
      'connections',
    );
  }

  async fetchContactGroups(): Promise<unknown[]> {
    return this.fetchPagedCollection('/contactGroups', { pageSize: '1000' }, 'contactGroups');
  }

  async fetchOtherContacts(): Promise<unknown[]> {
    return this.fetchPagedCollection(
      '/otherContacts',
      {
        readMask: OTHER_CONTACTS_READ_MASK,
        pageSize: '1000',
      },
      'otherContacts',
    );
  }

  private async fetchPagedCollection(
    endpoint: string,
    params: Record<string, string>,
    collectionKey: string,
  ): Promise<unknown[]> {
    try {
      return await this.fetchPages(endpoint, params, collectionKey);
    } catch (error) {
      if (!GoogleApiError.isUnauthorized(error)) {
        throw error;
      }
      // The cached access token was rejected; drop it so the next request
      // re-authenticates, then retry the collection once.
      this.auth.invalidate?.();
      this.logger.warn(`Access token rejected for ${endpoint}; refreshing token and retrying once`);
      return this.fetchPages(endpoint, params, collectionKey);
    }
  }

  private async fetchPages(
    endpoint: string,
    params: Record<string, string>,
    collectionKey: string,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let pageToken: string | null = null;

    while (true) {
      const query = new URLSearchParams(params);
      if (pageToken) {
        query.set('pageToken', pageToken);
      }
      const response = await this.apiGet(`${endpoint}?${query.toString()}`);
      const page = this.parsePage(response.body, response.statusCode, collectionKey);

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
    collectionKey: string,
  ): { items: unknown[]; nextPageToken: string | null } {
    const body = this.parseJson(text);
    if (statusCode >= 400 || body.error) {
      const detail =
        body.error && typeof body.error === 'object'
          ? String((body.error as Record<string, unknown>).message || 'Unknown error')
          : String(body.message || `HTTP ${statusCode}`);
      throw new GoogleApiError(`Google People API error: ${detail}`, statusCode);
    }
    // Unlike the Calendar and Tasks APIs, the People API returns each
    // collection under its own key (connections, contactGroups,
    // otherContacts) instead of a shared `items` field.
    const items = Array.isArray(body[collectionKey]) ? (body[collectionKey] as unknown[]) : [];
    return {
      items,
      nextPageToken: (body.nextPageToken as string | null | undefined) ?? null,
    };
  }

  private parseJson(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.error('Invalid JSON response from Google People API');
      return {};
    }
  }
}
