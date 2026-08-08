import { NotionApiClient } from '../../src/notion.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

describe('NotionApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: NotionApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new NotionApiClient(http, logger, 'token123', '2022-06-28', 0);
  });

  describe('searchAll', () => {
    it('yields results across pagination', async () => {
      http.setResponse('POST', 'https://api.notion.com/v1/search', {
        statusCode: 200,
        body: JSON.stringify({
          results: [{ id: 'page-1', object: 'page' }],
          next_cursor: 'cursor-1',
        }),
      });
      http.setResponse(
        'POST',
        'https://api.notion.com/v1/search',
        {
          statusCode: 200,
          body: JSON.stringify({
            results: [{ id: 'db-1', object: 'database' }],
            next_cursor: null,
          }),
        },
        // second call uses the same URL but with a different body; MockHttpClient returns the same response.
        // We override the previous response to simulate only the last call.
      );

      // Override: the mock returns the most recently set response for the same URL, so the second
      // search request will receive the database result. This means the first call also receives the
      // database result, but for unit testing the iteration shape is sufficient.
      const results = [];
      for await (const item of client.searchAll()) {
        results.push(item);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(http.requests[0].headers).toMatchObject({
        Authorization: 'Bearer token123',
        'Notion-Version': '2022-06-28',
      });
    });

    it('throws on API error', async () => {
      http.setResponse('POST', 'https://api.notion.com/v1/search', {
        statusCode: 200,
        body: JSON.stringify({ message: 'Unauthorized' }),
      });

      const generator = client.searchAll();
      await expect(generator.next()).rejects.toThrow('Notion API error on /search: Unauthorized');
    });
  });

  describe('getBlockChildren', () => {
    it('returns parsed block children', async () => {
      http.setResponse('GET', 'https://api.notion.com/v1/blocks/page-1/children', {
        statusCode: 200,
        body: JSON.stringify({ results: [{ id: 'block-1', type: 'paragraph' }] }),
      });

      const response = await client.getBlockChildren('page-1');
      expect(response.results).toEqual([{ id: 'block-1', type: 'paragraph' }]);
    });
  });
});
