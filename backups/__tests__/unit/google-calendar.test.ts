import { GoogleAuth } from '../../src/google-auth.js';
import { GoogleCalendarApiClient } from '../../src/google-calendar.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

const auth: GoogleAuth = { getAccessToken: async () => 'token123' };

const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

describe('GoogleCalendarApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: GoogleCalendarApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new GoogleCalendarApiClient(http, logger, auth);
  });

  describe('fetchCalendars', () => {
    it('returns all calendars across pages', async () => {
      http.setResponse('GET', `${CALENDAR_LIST_URL}?maxResults=250`, {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ id: 'primary', summary: 'Personal' }],
          nextPageToken: 'page2',
        }),
      });
      http.setResponse('GET', `${CALENDAR_LIST_URL}?maxResults=250&pageToken=page2`, {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'team', summary: 'Team' }] }),
      });

      const calendars = await client.fetchCalendars();

      expect(calendars).toEqual([
        { id: 'primary', summary: 'Personal' },
        { id: 'team', summary: 'Team' },
      ]);
      expect(http.requests[0].headers).toEqual({ Authorization: 'Bearer token123' });
    });

    it('returns an empty list when items is missing', async () => {
      http.setResponse('GET', `${CALENDAR_LIST_URL}?maxResults=250`, {
        statusCode: 200,
        body: JSON.stringify({}),
      });

      const calendars = await client.fetchCalendars();
      expect(calendars).toEqual([]);
    });

    it('throws on API error', async () => {
      http.setResponse('GET', `${CALENDAR_LIST_URL}?maxResults=250`, {
        statusCode: 403,
        body: JSON.stringify({ error: { message: 'Insufficient Permission' } }),
      });

      await expect(client.fetchCalendars()).rejects.toThrow(
        'Google Calendar API error: Insufficient Permission',
      );
    });
  });

  describe('fetchEvents', () => {
    it('expands recurring events and paginates', async () => {
      const baseQuery = 'maxResults=2500&singleEvents=true&orderBy=startTime';
      http.setResponse('GET', `${EVENTS_URL}?${baseQuery}`, {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ id: 'evt1', summary: 'One' }],
          nextPageToken: 'page2',
        }),
      });
      http.setResponse('GET', `${EVENTS_URL}?${baseQuery}&pageToken=page2`, {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'evt2', summary: 'Two' }] }),
      });

      const events = await client.fetchEvents('primary', { showDeleted: false });

      expect(events).toEqual([
        { id: 'evt1', summary: 'One' },
        { id: 'evt2', summary: 'Two' },
      ]);
    });

    it('includes showDeleted when enabled and encodes the calendar id', async () => {
      const url =
        'https://www.googleapis.com/calendar/v3/calendars/shared%40group.calendar.google.com/events' +
        '?maxResults=2500&singleEvents=true&orderBy=startTime&showDeleted=true';
      http.setResponse('GET', url, {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      });

      const events = await client.fetchEvents('shared@group.calendar.google.com', {
        showDeleted: true,
      });

      expect(events).toEqual([]);
      expect(http.requests[0].url).toBe(url);
    });
  });
});
