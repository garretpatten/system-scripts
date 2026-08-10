import { GoogleAuth } from '../../src/google-auth.js';
import { GoogleTasksApiClient } from '../../src/google-tasks.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

const auth: GoogleAuth = { getAccessToken: async () => 'token123' };

const LISTS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';
const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists/list123/tasks';

describe('GoogleTasksApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: GoogleTasksApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new GoogleTasksApiClient(http, logger, auth);
  });

  describe('fetchTaskLists', () => {
    it('returns all task lists across pages', async () => {
      http.setResponse('GET', `${LISTS_URL}?maxResults=1000`, {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ id: 'list1', title: 'My Tasks' }],
          nextPageToken: 'page2',
        }),
      });
      http.setResponse('GET', `${LISTS_URL}?maxResults=1000&pageToken=page2`, {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'list2', title: 'Work' }] }),
      });

      const taskLists = await client.fetchTaskLists();

      expect(taskLists).toEqual([
        { id: 'list1', title: 'My Tasks' },
        { id: 'list2', title: 'Work' },
      ]);
      expect(http.requests[0].headers).toEqual({ Authorization: 'Bearer token123' });
    });

    it('throws on API error', async () => {
      http.setResponse('GET', `${LISTS_URL}?maxResults=1000`, {
        statusCode: 401,
        body: JSON.stringify({ error: { message: 'Invalid Credentials' } }),
      });

      await expect(client.fetchTaskLists()).rejects.toThrow(
        'Google Tasks API error: Invalid Credentials',
      );
    });
  });

  describe('fetchTasks', () => {
    it('requests completed, deleted, and hidden tasks by default', async () => {
      const url = `${TASKS_URL}?maxResults=100&showCompleted=true&showDeleted=true&showHidden=true`;
      http.setResponse('GET', url, {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'task1', title: 'Buy milk' }] }),
      });

      const tasks = await client.fetchTasks('list123', {
        showCompleted: true,
        showDeleted: true,
        showHidden: true,
      });

      expect(tasks).toEqual([{ id: 'task1', title: 'Buy milk' }]);
      expect(http.requests[0].url).toBe(url);
    });

    it('omits completed, deleted, and hidden tasks when disabled', async () => {
      const url = `${TASKS_URL}?maxResults=100&showCompleted=false&showDeleted=false&showHidden=false`;
      http.setResponse('GET', url, {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      });

      const tasks = await client.fetchTasks('list123', {
        showCompleted: false,
        showDeleted: false,
        showHidden: false,
      });

      expect(tasks).toEqual([]);
      expect(http.requests[0].url).toBe(url);
    });
  });
});
