import { loadEnvFile } from '../../src/env.js';
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
