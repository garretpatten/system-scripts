import { GoogleAuth } from '../../src/google-auth.js';
import { GoogleContactsApiClient } from '../../src/google-contacts.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

const auth: GoogleAuth = { getAccessToken: async () => 'token123' };

const CONNECTIONS_URL = 'https://people.googleapis.com/v1/people/me/connections';
const CONTACT_GROUPS_URL = 'https://people.googleapis.com/v1/contactGroups';
const OTHER_CONTACTS_URL = 'https://people.googleapis.com/v1/otherContacts';

describe('GoogleContactsApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: GoogleContactsApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new GoogleContactsApiClient(http, logger, auth);
  });

  describe('fetchContacts', () => {
    it('returns all connections across pages', async () => {
      http.setResponse('GET', `${CONNECTIONS_URL}?personFields=*&pageSize=1000`, {
        statusCode: 200,
        body: JSON.stringify({
          connections: [{ resourceName: 'people/c1' }],
          nextPageToken: 'page2',
        }),
      });
      http.setResponse('GET', `${CONNECTIONS_URL}?personFields=*&pageSize=1000&pageToken=page2`, {
        statusCode: 200,
        body: JSON.stringify({ connections: [{ resourceName: 'people/c2' }] }),
      });

      const contacts = await client.fetchContacts();

      expect(contacts).toEqual([{ resourceName: 'people/c1' }, { resourceName: 'people/c2' }]);
      expect(http.requests[0].headers).toEqual({ Authorization: 'Bearer token123' });
    });

    it('returns an empty list when connections is missing', async () => {
      http.setResponse('GET', `${CONNECTIONS_URL}?personFields=*&pageSize=1000`, {
        statusCode: 200,
        body: JSON.stringify({}),
      });

      const contacts = await client.fetchContacts();

      expect(contacts).toEqual([]);
    });

    it('throws on API error', async () => {
      http.setResponse('GET', `${CONNECTIONS_URL}?personFields=*&pageSize=1000`, {
        statusCode: 403,
        body: JSON.stringify({
          error: { message: 'Request had insufficient authentication scopes.' },
        }),
      });

      await expect(client.fetchContacts()).rejects.toThrow(
        'Google People API error: Request had insufficient authentication scopes.',
      );
    });
  });

  describe('fetchContactGroups', () => {
    it('returns all contact groups across pages', async () => {
      http.setResponse('GET', `${CONTACT_GROUPS_URL}?pageSize=1000`, {
        statusCode: 200,
        body: JSON.stringify({
          contactGroups: [{ resourceName: 'contactGroups/1', formattedName: 'Family' }],
          nextPageToken: 'page2',
        }),
      });
      http.setResponse('GET', `${CONTACT_GROUPS_URL}?pageSize=1000&pageToken=page2`, {
        statusCode: 200,
        body: JSON.stringify({
          contactGroups: [{ resourceName: 'contactGroups/2', formattedName: 'Friends' }],
        }),
      });

      const contactGroups = await client.fetchContactGroups();

      expect(contactGroups).toEqual([
        { resourceName: 'contactGroups/1', formattedName: 'Family' },
        { resourceName: 'contactGroups/2', formattedName: 'Friends' },
      ]);
    });
  });

  describe('fetchOtherContacts', () => {
    it('requests all fields via readMask and paginates', async () => {
      http.setResponse('GET', `${OTHER_CONTACTS_URL}?readMask=*&pageSize=1000`, {
        statusCode: 200,
        body: JSON.stringify({
          otherContacts: [{ resourceName: 'people/o1' }],
          nextPageToken: 'page2',
        }),
      });
      http.setResponse('GET', `${OTHER_CONTACTS_URL}?readMask=*&pageSize=1000&pageToken=page2`, {
        statusCode: 200,
        body: JSON.stringify({ otherContacts: [{ resourceName: 'people/o2' }] }),
      });

      const otherContacts = await client.fetchOtherContacts();

      expect(otherContacts).toEqual([{ resourceName: 'people/o1' }, { resourceName: 'people/o2' }]);
      expect(http.requests[0].url).toBe(`${OTHER_CONTACTS_URL}?readMask=*&pageSize=1000`);
    });
  });

  it('refreshes the token and retries once when the access token is rejected', async () => {
    const invalidate = vi.fn();
    const retryClient = new GoogleContactsApiClient(http, logger, {
      getAccessToken: async () => 'token123',
      invalidate,
    });
    const url = `${CONNECTIONS_URL}?personFields=*&pageSize=1000`;
    http.setResponseSequence('GET', url, [
      { statusCode: 401, body: JSON.stringify({ error: { message: 'Invalid Credentials' } }) },
      {
        statusCode: 200,
        body: JSON.stringify({ connections: [{ resourceName: 'people/c1' }] }),
      },
    ]);

    const contacts = await retryClient.fetchContacts();

    expect(contacts).toEqual([{ resourceName: 'people/c1' }]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(http.requests).toHaveLength(2);
    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('Access token rejected'),
      ),
    ).toBe(true);
  });
});
