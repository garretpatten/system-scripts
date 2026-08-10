import { GoogleAuthClient, GoogleOAuthCredentials } from '../../src/google-auth.js';
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
