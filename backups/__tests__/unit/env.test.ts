import { loadEnvFile, saveEnvValue } from '../../src/env.js';
import { MockFileSystem } from '../test-helpers.js';

describe('loadEnvFile', () => {
  let fs: MockFileSystem;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    fs = new MockFileSystem();
    env = {};
  });

  it('loads simple key-value pairs', async () => {
    await fs.writeFile('/project/.env', 'FOO=bar\nBAZ=qux\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
    expect(env.BAZ).toBe('qux');
  });

  it('does not override existing environment variables', async () => {
    env.FOO = 'existing';
    await fs.writeFile('/project/.env', 'FOO=bar\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('existing');
  });

  it('strips surrounding double quotes', async () => {
    await fs.writeFile('/project/.env', 'FOO="bar"\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
  });

  it('strips surrounding single quotes', async () => {
    await fs.writeFile('/project/.env', "FOO='bar'\n");
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
  });

  it('skips empty lines and comments', async () => {
    await fs.writeFile('/project/.env', '# comment\n\nFOO=bar\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
    expect(Object.keys(env)).toHaveLength(1);
  });

  it('returns early when .env is missing', async () => {
    await loadEnvFile(fs, env, '/missing');
    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe('saveEnvValue', () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('creates the .env file when it is missing', async () => {
    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    expect(fs.files.get('/project/.env')).toBe('TOKEN="abc"\n');
  });

  it('replaces an existing empty value', async () => {
    await fs.writeFile('/project/.env', 'FOO=bar\nTOKEN=""\n');

    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    expect(fs.files.get('/project/.env')).toBe('FOO=bar\nTOKEN="abc"\n');
  });

  it('replaces an existing value', async () => {
    await fs.writeFile('/project/.env', 'TOKEN="old"\n');

    await saveEnvValue(fs, '/project', 'TOKEN', 'new');

    expect(fs.files.get('/project/.env')).toBe('TOKEN="new"\n');
  });

  it('appends the key when it is absent and preserves other lines', async () => {
    await fs.writeFile('/project/.env', '# comment\nFOO=bar\n');

    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    expect(fs.files.get('/project/.env')).toBe('# comment\nFOO=bar\nTOKEN="abc"\n');
  });

  it('round-trips with loadEnvFile', async () => {
    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    const env: NodeJS.ProcessEnv = {};
    await loadEnvFile(fs, env, '/project');

    expect(env.TOKEN).toBe('abc');
  });
});
