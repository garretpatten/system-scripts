/**
 * Google API error carrying the HTTP status code so callers can recognize
 * authentication failures (401) and retry with a fresh access token.
 */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }

  static isUnauthorized(error: unknown): boolean {
    return error instanceof GoogleApiError && error.statusCode === 401;
  }
}
