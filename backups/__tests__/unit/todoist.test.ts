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
      http.setResponse(
        'GET',
        'https://api.todoist.com/rest/v2/tasks?limit=200&offset=0',
        {
          statusCode: 200,
          body: JSON.stringify([{ id: '1', content: 'Task 1' }]),
        }
      );
      http.setResponse(
        'GET',
        'https://api.todoist.com/rest/v2/tasks?limit=200&offset=200',
        {
          statusCode: 200,
          body: JSON.stringify([]),
        }
      );

      const tasks = await client.fetchTasks();

      expect(tasks).toEqual([{ id: '1', content: 'Task 1' }]);
      expect(http.requests[0].headers).toEqual({ Authorization: 'Bearer token123' });
    });

    it('throws on API error message', async () => {
      http.setResponse(
        'GET',
        'https://api.todoist.com/rest/v2/tasks?limit=200&offset=0',
        {
          statusCode: 200,
          body: JSON.stringify({ message: 'Invalid token' }),
        }
      );

      await expect(client.fetchTasks()).rejects.toThrow('Todoist API error: Invalid token');
    });
  });

  describe('fetchProjects', () => {
    it('returns projects', async () => {
      http.setResponse('GET', 'https://api.todoist.com/rest/v2/projects', {
        statusCode: 200,
        body: JSON.stringify([{ id: '1', name: 'Inbox' }]),
      });

      const projects = await client.fetchProjects();
      expect(projects).toEqual([{ id: '1', name: 'Inbox' }]);
    });
  });

  describe('fetchLabels', () => {
    it('returns labels', async () => {
      http.setResponse('GET', 'https://api.todoist.com/rest/v2/labels', {
        statusCode: 200,
        body: JSON.stringify([{ id: '1', name: 'urgent' }]),
      });

      const labels = await client.fetchLabels();
      expect(labels).toEqual([{ id: '1', name: 'urgent' }]);
    });
  });
});
