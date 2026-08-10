import {
  AuthorizationRedirect,
  buildAuthorizationUrl,
  GOOGLE_BACKUP_SCOPES,
  GoogleAuthClient,
  GoogleAuthorizer,
  GoogleOAuthCredentials,
  RedirectListener,
} from '../../src/google-auth.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

describe('GoogleAuthClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let credentials: GoogleOAuthCredentials;
  let auth: GoogleAuthClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    credentials = {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
    };
    auth = new GoogleAuthClient(http, logger, credentials);
  });

  it('exchanges the refresh token for an access token', async () => {
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token', expires_in: 3599 }),
    });

    const token = await auth.getAccessToken();

    expect(token).toBe('access-token');
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
  });

  it('caches the access token across calls', async () => {
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token' }),
    });

    await auth.getAccessToken();
    await auth.getAccessToken();

    expect(http.requests).toHaveLength(1);
  });

  it('throws on OAuth error responses', async () => {
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 400,
      body: JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Token has been revoked.',
      }),
    });

    await expect(auth.getAccessToken()).rejects.toThrow(
      'Google OAuth token refresh failed: Token has been revoked.',
    );
  });

  it('throws when the response is missing an access token', async () => {
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({}),
    });

    await expect(auth.getAccessToken()).rejects.toThrow(
      'Google OAuth token response missing access_token',
    );
  });
});

describe('buildAuthorizationUrl', () => {
  it('requests an offline token with the backup scopes', () => {
    const url = buildAuthorizationUrl(
      'client-id',
      'http://127.0.0.1:43137',
      'state123',
      GOOGLE_BACKUP_SCOPES,
    );

    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43137');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/calendar.readonly ' +
        'https://www.googleapis.com/auth/tasks.readonly',
    );
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe('state123');
  });
});

class FakeRedirectListener implements RedirectListener {
  redirect: AuthorizationRedirect = { code: 'auth-code', error: null, state: 'test-state' };
  failWith: Error | null = null;
  started = false;
  closed = false;

  async start(): Promise<number> {
    this.started = true;
    return 43137;
  }

  async waitForAuthorization(_timeoutMs: number): Promise<AuthorizationRedirect> {
    if (this.failWith) {
      throw this.failWith;
    }
    return this.redirect;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('GoogleAuthorizer', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let listener: FakeRedirectListener;
  let credentials: GoogleOAuthCredentials;
  let authorizer: GoogleAuthorizer;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    listener = new FakeRedirectListener();
    credentials = {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: '',
    };
    authorizer = new GoogleAuthorizer(http, logger, listener, () => 'test-state');
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'new-refresh-token' }),
    });
  });

  it('returns the refresh token from the authorization code exchange', async () => {
    const refreshToken = await authorizer.authorize(credentials);

    expect(refreshToken).toBe('new-refresh-token');
    expect(listener.started).toBe(true);
    expect(listener.closed).toBe(true);
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(
      logger.messages.some(
        (m) =>
          m.message.includes('https://accounts.google.com/o/oauth2/v2/auth') &&
          m.message.includes('redirect_uri=http%3A%2F%2F127.0.0.1%3A43137'),
      ),
    ).toBe(true);
  });

  it('throws when the user denies access', async () => {
    listener.redirect = { code: null, error: 'access_denied', state: 'test-state' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Google authorization failed: access_denied',
    );
    expect(listener.closed).toBe(true);
  });

  it('throws on state mismatch', async () => {
    listener.redirect = { code: 'auth-code', error: null, state: 'forged-state' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Google authorization failed: state mismatch',
    );
    expect(listener.closed).toBe(true);
  });

  it('throws when no authorization code is received', async () => {
    listener.redirect = { code: null, error: null, state: 'test-state' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Google authorization failed: no authorization code received',
    );
  });

  it('throws when the code exchange fails', async () => {
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Malformed auth code.' }),
    });

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Google OAuth code exchange failed: Malformed auth code.',
    );
  });

  it('throws when the exchange returns no refresh token', async () => {
    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token' }),
    });

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Google OAuth code exchange did not return a refresh token',
    );
  });

  it('closes the listener when waiting times out', async () => {
    listener.failWith = new Error('Timed out waiting for Google authorization');

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Timed out waiting for Google authorization',
    );
    expect(listener.closed).toBe(true);
  });

  it('requires client credentials before starting the listener', async () => {
    credentials = { clientId: '', clientSecret: '', refreshToken: '' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env or .env',
    );
    expect(listener.started).toBe(false);
  });
});
