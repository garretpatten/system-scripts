import { GitRemoteAuth } from './types.js';

/**
 * Builds git environment variables that attach HTTP Basic credentials to
 * every request of a single git invocation. Passing credentials this way,
 * instead of embedding them in the remote URL, keeps tokens out of
 * `.git/config`, process listings, and command error output. Requires
 * git 2.31+ (the GIT_CONFIG_* environment mechanism).
 */
export function basicAuthEnv(auth: GitRemoteAuth): NodeJS.ProcessEnv {
  const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${credentials}`,
  };
}
