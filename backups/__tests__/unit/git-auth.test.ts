import { basicAuthEnv } from '../../src/git-auth.js';

describe('basicAuthEnv', () => {
  it('builds per-invocation git config for HTTP Basic credentials', () => {
    const env = basicAuthEnv({ username: 'x-access-token', password: 'token123' });

    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toBe(
      `Authorization: Basic ${Buffer.from('x-access-token:token123').toString('base64')}`,
    );
  });

  it('keeps the raw credentials out of the environment values', () => {
    const env = basicAuthEnv({ username: 'oauth2', password: 'secret-token' });

    expect(JSON.stringify(env)).not.toContain('secret-token');
  });
});
