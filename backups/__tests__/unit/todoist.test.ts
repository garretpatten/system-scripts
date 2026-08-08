import { TodoistApiClient } from '../../src/todoist.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

describe('TodoistApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: TodoistApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new TodoistApiClient(http, logger, 'token123');
  });

  describe('fetchTasks', () => {
    it('returns all tasks across pages', async () => {
      http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
        statusCode: 200,
        body: JSON.stringify({
          results: [{ id: '1', content: 'Task 1' }],
          next_cursor: 'cursor1',
        }),
      });
      http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200&cursor=cursor1', {
        statusCode: 200,
        body: JSON.stringify({ results: [], next_cursor: null }),
      });

      const tasks = await client.fetchTasks();

      expect(tasks).toEqual([{ id: '1', content: 'Task 1' }]);
      expect(http.requests[0].headers).toEqual({ Authorization: 'Bearer token123' });
    });

    it('throws on API error message', async () => {
      http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
        statusCode: 200,
        body: JSON.stringify({ message: 'Invalid token' }),
      });

      await expect(client.fetchTasks()).rejects.toThrow('Todoist API error: Invalid token');
    });
  });

  describe('fetchProjects', () => {
    it('returns projects', async () => {
      http.setResponse('GET', 'https://api.todoist.com/api/v1/projects?limit=200', {
        statusCode: 200,
        body: JSON.stringify({
          results: [{ id: '1', name: 'Inbox' }],
          next_cursor: null,
        }),
      });

      const projects = await client.fetchProjects();
      expect(projects).toEqual([{ id: '1', name: 'Inbox' }]);
    });
  });

  describe('fetchLabels', () => {
    it('returns labels', async () => {
      http.setResponse('GET', 'https://api.todoist.com/api/v1/labels?limit=200', {
        statusCode: 200,
        body: JSON.stringify({
          results: [{ id: '1', name: 'urgent' }],
          next_cursor: null,
        }),
      });

      const labels = await client.fetchLabels();
      expect(labels).toEqual([{ id: '1', name: 'urgent' }]);
    });
  });
});
