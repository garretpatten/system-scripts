import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger, FileLogger, redactSecrets } from '../../src/logger.js';
import { MockFileSystem, MockLogger } from '../test-helpers.js';

describe('redactSecrets', () => {
  it('masks passwords embedded in URL userinfo', () => {
    expect(redactSecrets('failed: https://oauth2:secret-token@gitlab.com/a/b.git')).toBe(
      'failed: https://oauth2:***@gitlab.com/a/b.git',
    );
    expect(redactSecrets('https://x-access-token:ghp_abc123@github.com/o/r.git')).toBe(
      'https://x-access-token:***@github.com/o/r.git',
    );
  });

  it('masks bare userinfo without a username', () => {
    expect(redactSecrets('clone https://token123@example.com/repo.git failed')).toBe(
      'clone https://***@example.com/repo.git failed',
    );
  });

  it('masks secret query parameters', () => {
    expect(redactSecrets('POST /token?client_secret=abc&grant_type=x')).toBe(
      'POST /token?client_secret=***&grant_type=x',
    );
    expect(redactSecrets('url has refresh_token=xyz inside')).toBe(
      'url has refresh_token=*** inside',
    );
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Backed up 12 repos to /home/user/Backup';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('ConsoleLogger', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(console, 'error').mockImplementation((line: string) => {
      logged.push(line);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redacts credentials before writing to the console', () => {
    new ConsoleLogger('test').error('git clone failed: https://oauth2:t0ken@gitlab.com/r.git');

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('https://oauth2:***@gitlab.com/r.git');
    expect(logged[0]).not.toContain('t0ken');
  });
});

describe('FileLogger', () => {
  let fs: MockFileSystem;
  let baseLogger: MockLogger;

  beforeEach(() => {
    fs = new MockFileSystem();
    baseLogger = new MockLogger();
  });

  it('redacts credentials before appending to the log file', async () => {
    const logger = new FileLogger(baseLogger, fs, '/tmp/backup.log');
    logger.error('git push failed: https://oauth2:t0ken@gitlab.com/r.git');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const content = fs.files.get('/tmp/backup.log') ?? '';
    expect(content).toContain('https://oauth2:***@gitlab.com/r.git');
    expect(content).not.toContain('t0ken');
  });
});
