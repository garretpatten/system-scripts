import { randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { HttpClient, Logger } from './types.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;

export const GOOGLE_BACKUP_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
];

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleAuth {
  getAccessToken(): Promise<string>;
}

export class GoogleAuthClient implements GoogleAuth {
  private accessToken: string | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly credentials: GoogleOAuthCredentials,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      refresh_token: this.credentials.refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    const response = await this.http.post(TOKEN_URL, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const parsed = parseJson(this.logger, response.body);

    if (response.statusCode !== 200 || parsed.error) {
      const detail = parsed.error_description || parsed.error || `HTTP ${response.statusCode}`;
      throw new Error(`Google OAuth token refresh failed: ${String(detail)}`);
    }

    if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
      throw new Error('Google OAuth token response missing access_token');
    }

    this.accessToken = parsed.access_token;
    return this.accessToken;
  }
}

export interface AuthorizationRedirect {
  code: string | null;
  error: string | null;
  state: string | null;
}

export interface RedirectListener {
  start(): Promise<number>;
  waitForAuthorization(timeoutMs: number): Promise<AuthorizationRedirect>;
  close(): Promise<void>;
}

/**
 * Listens on a loopback address for the OAuth 2.0 redirect that follows an
 * interactive authorization in the user's browser.
 */
export class LoopbackRedirectListener implements RedirectListener {
  private server: Server | null = null;

  async start(): Promise<number> {
    this.server = createServer();
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Could not start local authorization listener');
    }
    return address.port;
  }

  waitForAuthorization(timeoutMs: number): Promise<AuthorizationRedirect> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Authorization listener has not been started'));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for Google authorization'));
      }, timeoutMs);

      this.server.on('request', (request, response) => {
        const params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
        const code = params.get('code');
        const error = params.get('error');

        if (!code && !error) {
          // Ignore unrelated requests such as favicon lookups.
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end('Waiting for authorization...');
          return;
        }

        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          '<html><body><h1>Authorization complete</h1>' +
            '<p>You can close this tab and return to the terminal.</p></body></html>',
        );
        clearTimeout(timer);
        resolve({ code, error, state: params.get('state') });
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

export function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scopes: string[],
): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTHORIZATION_URL}?${query.toString()}`;
}

/**
 * Runs the one-time interactive OAuth 2.0 flow: opens the consent URL for the
 * user, waits for the loopback redirect, and exchanges the authorization code
 * for a refresh token.
 */
export class GoogleAuthorizer {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly listener: RedirectListener,
    private readonly generateState: () => string = () => randomBytes(16).toString('hex'),
    private readonly timeoutMs: number = DEFAULT_AUTHORIZATION_TIMEOUT_MS,
  ) {}

  async authorize(credentials: GoogleOAuthCredentials): Promise<string> {
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env or .env');
    }

    const port = await this.listener.start();
    const redirectUri = `http://127.0.0.1:${port}`;
    const state = this.generateState();
    const url = buildAuthorizationUrl(
      credentials.clientId,
      redirectUri,
      state,
      GOOGLE_BACKUP_SCOPES,
    );

    this.logger.info('Starting one-time Google authorization');
    this.logger.info('Open this URL in your browser to authorize the backups:');
    this.logger.info(url);

    let redirect: AuthorizationRedirect;
    try {
      redirect = await this.listener.waitForAuthorization(this.timeoutMs);
    } finally {
      await this.listener.close();
    }

    if (redirect.error) {
      throw new Error(`Google authorization failed: ${redirect.error}`);
    }
    if (redirect.state !== state) {
      throw new Error('Google authorization failed: state mismatch');
    }
    if (!redirect.code) {
      throw new Error('Google authorization failed: no authorization code received');
    }

    this.logger.info('Authorization received, exchanging for tokens...');
    return this.exchangeCode(credentials, redirect.code, redirectUri);
  }

  private async exchangeCode(
    credentials: GoogleOAuthCredentials,
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString();

    const response = await this.http.post(TOKEN_URL, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const parsed = parseJson(this.logger, response.body);

    if (response.statusCode !== 200 || parsed.error) {
      const detail = parsed.error_description || parsed.error || `HTTP ${response.statusCode}`;
      throw new Error(`Google OAuth code exchange failed: ${String(detail)}`);
    }

    if (typeof parsed.refresh_token !== 'string' || parsed.refresh_token.length === 0) {
      throw new Error('Google OAuth code exchange did not return a refresh token');
    }

    return parsed.refresh_token;
  }
}

function parseJson(logger: Logger, text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    logger.error('Invalid JSON response from Google OAuth token endpoint');
    return {};
  }
}
