import { GitLabApiClient } from '../../src/gitlab.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

describe('GitLabApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: GitLabApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    client = new GitLabApiClient(http, logger, 'https://gitlab.com', 'token123');
  });

  describe('getNamespaceId', () => {
    it('returns the matching namespace id', async () => {
      http.setResponse('GET', 'https://gitlab.com/api/v4/namespaces?search=octocat', {
        statusCode: 200,
        body: JSON.stringify([
          { id: 42, full_path: 'octocat' },
          { id: 99, full_path: 'octocat-group' },
        ]),
      });

      const id = await client.getNamespaceId('octocat');
      expect(id).toBe(42);
    });

    it('throws when no namespace matches', async () => {
      http.setResponse('GET', 'https://gitlab.com/api/v4/namespaces?search=octocat', {
        statusCode: 200,
        body: JSON.stringify([{ id: 42, full_path: 'other' }]),
      });

      await expect(client.getNamespaceId('octocat')).rejects.toThrow(
        'Could not resolve GitLab namespace: octocat'
      );
    });
  });

  describe('projectExists', () => {
    it('returns true when the project has an id', async () => {
      http.setResponse('GET', 'https://gitlab.com/api/v4/projects/octocat%2Fhello', {
        statusCode: 200,
        body: JSON.stringify({ id: 123 }),
      });

      const exists = await client.projectExists('octocat/hello');
      expect(exists).toBe(true);
    });

    it('returns false when the project has no id', async () => {
      http.setResponse('GET', 'https://gitlab.com/api/v4/projects/octocat%2Fmissing', {
        statusCode: 200,
        body: JSON.stringify({ message: '404 Project Not Found' }),
      });

      const exists = await client.projectExists('octocat/missing');
      expect(exists).toBe(false);
    });
  });

  describe('createProject', () => {
    it('succeeds when the response has an id', async () => {
      http.setResponse('POST', 'https://gitlab.com/api/v4/projects', {
        statusCode: 201,
        body: JSON.stringify({ id: 456 }),
      });

      await client.createProject('hello', 42, 'private');

      expect(http.requests[0].headers).toMatchObject({
        'PRIVATE-TOKEN': 'token123',
        'Content-Type': 'application/json',
      });
    });

    it('throws when creation fails', async () => {
      http.setResponse('POST', 'https://gitlab.com/api/v4/projects', {
        statusCode: 400,
        body: JSON.stringify({ message: 'name already taken' }),
      });

      await expect(client.createProject('hello', 42, 'private')).rejects.toThrow(
        'GitLab project creation failed for hello: name already taken'
      );
    });
  });

  describe('deleteProject', () => {
    it('succeeds when the project is deleted', async () => {
      http.setResponse('DELETE', 'https://gitlab.com/api/v4/projects/123', {
        statusCode: 202,
        body: JSON.stringify({ message: '202 Accepted' }),
      });

      await client.deleteProject(123);

      expect(http.requests[http.requests.length - 1].headers).toMatchObject({
        'PRIVATE-TOKEN': 'token123',
      });
    });

    it('throws when deletion fails', async () => {
      http.setResponse('DELETE', 'https://gitlab.com/api/v4/projects/123', {
        statusCode: 404,
        body: JSON.stringify({ message: '404 Not Found' }),
      });

      await expect(client.deleteProject(123)).rejects.toThrow(
        'GitLab project deletion failed for 123: 404 Not Found'
      );
    });
  });

  describe('listProjects', () => {
    it('lists projects under a namespace', async () => {
      http.setResponse(
        'GET',
        'https://gitlab.com/api/v4/projects?namespace_id=42&per_page=100&page=1',
        {
          statusCode: 200,
          body: JSON.stringify([
            { id: 1, path_with_namespace: 'octocat/hello' },
            { id: 2, path_with_namespace: 'octocat/world' },
          ]),
        }
      );

      const projects = [];
      for await (const project of client.listProjects(42)) {
        projects.push(project);
      }

      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({ id: 1, pathWithNamespace: 'octocat/hello' });
      expect(projects[1]).toEqual({ id: 2, pathWithNamespace: 'octocat/world' });
    });

    it('throws on API error messages', async () => {
      http.setResponse(
        'GET',
        'https://gitlab.com/api/v4/projects?namespace_id=42&per_page=100&page=1',
        {
          statusCode: 200,
          body: JSON.stringify({ message: 'Unauthorized' }),
        }
      );

      const generator = client.listProjects(42);
      await expect(generator.next()).rejects.toThrow('GitLab API error: Unauthorized');
    });
  });

  describe('buildRemoteUrl', () => {
    it('returns an oauth2 authenticated URL', () => {
      expect(client.buildRemoteUrl('octocat/hello')).toBe(
        'https://oauth2:token123@gitlab.com/octocat/hello.git'
      );
    });
  });
});
