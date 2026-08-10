import { HttpClient, Logger } from './types.js';

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleAuth {
  getAccessToken(): Promise<string>;
}

export class GoogleAuthClient implements GoogleAuth {
  private readonly tokenUrl = 'https://oauth2.googleapis.com/token';
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

    const response = await this.http.post(this.tokenUrl, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const parsed = this.parseJson(response.body);

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

  private parseJson(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.error('Invalid JSON response from Google OAuth token endpoint');
      return {};
    }
  }
}
