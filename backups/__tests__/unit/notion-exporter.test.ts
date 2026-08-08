import { NotionExporter, formatRichText, richTextToMarkdown } from '../../src/notion-exporter.js';
import { NotionClient } from '../../src/notion.js';
import { MockFileSystem, MockLogger } from '../test-helpers.js';

class MockNotionClient implements NotionClient {
  searchResults: Record<string, unknown>[] = [];
  blockChildren = new Map<string, Record<string, unknown>[]>();
  databases = new Map<string, Record<string, unknown>>();
  databaseRows = new Map<string, Record<string, unknown>[]>();

  async *searchAll(): AsyncGenerator<Record<string, unknown>, void, unknown> {
    for (const item of this.searchResults) {
      yield item;
    }
  }

  async *queryDatabase(databaseId: string): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const rows = this.databaseRows.get(databaseId) ?? [];
    for (const row of rows) {
      yield row;
    }
  }

  async getBlockChildren(blockId: string): Promise<Record<string, unknown>> {
    return { results: this.blockChildren.get(blockId) ?? [] };
  }

  async getDatabase(databaseId: string): Promise<Record<string, unknown>> {
    return this.databases.get(databaseId) ?? {};
  }
}

describe('NotionExporter', () => {
  let client: MockNotionClient;
  let fs: MockFileSystem;
  let logger: MockLogger;
  let exporter: NotionExporter;

  beforeEach(() => {
    client = new MockNotionClient();
    fs = new MockFileSystem();
    logger = new MockLogger();
    exporter = new NotionExporter(client, fs, logger);
  });

  describe('discoverObjects', () => {
    it('extracts pages and databases', async () => {
      client.searchResults = [
        {
          id: 'page-1',
          object: 'page',
          parent: {},
          properties: {
            title: {
              type: 'title',
              title: [{ plain_text: 'My Page' }],
            },
          },
        },
        {
          id: 'db-1',
          object: 'database',
          parent: {},
          title: [{ plain_text: 'My Database' }],
        },
      ];

      const objects = await exporter.discoverObjects();

      expect(objects).toHaveLength(2);
      expect(objects[0]).toEqual({ id: 'page-1', object: 'page', title: 'My Page', parentId: null });
      expect(objects[1]).toEqual({ id: 'db-1', object: 'database', title: 'My Database', parentId: null });
    });
  });

  describe('getParentPath', () => {
    it('builds nested paths', async () => {
      client.searchResults = [
        { id: 'parent', object: 'page', parent: {}, properties: { title: { type: 'title', title: [{ plain_text: 'Parent' }] } } },
        { id: 'child', object: 'page', parent: { page_id: 'parent' }, properties: { title: { type: 'title', title: [{ plain_text: 'Child' }] } } },
        { id: 'grandchild', object: 'page', parent: { page_id: 'child' }, properties: { title: { type: 'title', title: [{ plain_text: 'Grandchild' }] } } },
      ];
      await exporter.discoverObjects();

      expect(exporter.getParentPath('grandchild')).toBe('Parent/Child');
    });

    it('breaks cycles after one traversal', async () => {
      client.searchResults = [
        { id: 'a', object: 'page', parent: { page_id: 'b' }, properties: { title: { type: 'title', title: [{ plain_text: 'A' }] } } },
        { id: 'b', object: 'page', parent: { page_id: 'a' }, properties: { title: { type: 'title', title: [{ plain_text: 'B' }] } } },
      ];
      await exporter.discoverObjects();

      expect(exporter.getParentPath('a')).toBe('A/B');
    });
  });

  describe('exportPage', () => {
    it('writes markdown for a page with blocks', async () => {
      client.blockChildren.set('page-1', [
        {
          id: 'block-1',
          type: 'heading_1',
          has_children: false,
          heading_1: { rich_text: [{ plain_text: 'Hello', annotations: {} }] },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [{ plain_text: 'World', annotations: {} }] },
        },
      ]);

      await exporter.exportPage('page-1', 'My Page', '/out/My Page.md');

      const content = fs.files.get('/out/My Page.md');
      expect(content).toContain('# My Page');
      expect(content).toContain('# Hello');
      expect(content).toContain('World');
    });
  });

  describe('exportDatabase', () => {
    it('writes markdown for a database', async () => {
      client.databases.set('db-1', {
        title: [{ plain_text: 'My Database' }],
        description: [],
        properties: { Name: { type: 'title' } },
      });
      client.databaseRows.set('db-1', [
        {
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Entry 1' }] },
          },
        },
      ]);

      await exporter.exportDatabase('db-1', 'My Database', '/out/My Database.md');

      const content = fs.files.get('/out/My Database.md');
      expect(content).toContain('# My Database');
      expect(content).toContain('## Entry 1');
    });
  });

  describe('uniqueFilePath', () => {
    it('appends counters for duplicate paths', async () => {
      await fs.writeFile('/dir/file.md', '');
      await fs.writeFile('/dir/file_1.md', '');

      const path = await exporter.uniqueFilePath('/dir', 'file', '.md');
      expect(path).toBe('/dir/file_2.md');
    });
  });
});

describe('richTextToMarkdown', () => {
  it('applies bold formatting', () => {
    const text = [{ plain_text: 'bold', annotations: { bold: true }, href: null }];
    expect(richTextToMarkdown({ rich_text: text })).toBe('**bold**');
  });

  it('applies link formatting', () => {
    const text = [{ plain_text: 'link', annotations: {}, href: 'https://example.com' }];
    expect(richTextToMarkdown({ rich_text: text })).toBe('[link](https://example.com)');
  });
});

describe('formatRichText', () => {
  it('handles nested annotations', () => {
    const text = {
      plain_text: 'text',
      annotations: { bold: true, italic: true },
      href: null,
    };
    expect(formatRichText(text)).toBe('***text***');
  });
});
