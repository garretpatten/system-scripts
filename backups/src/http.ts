import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { HttpClient, HttpResponse } from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class NodeHttpClient implements HttpClient {
  private readonly timeoutMs: number;

  /**
   * @param timeoutMs idle-socket timeout applied to every request so a
   * stalled connection rejects instead of hanging the whole backup run.
   */
  constructor(timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('GET', url, undefined, headers);
  }

  async post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('POST', url, body, headers);
  }

  async delete(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('DELETE', url, undefined, headers);
  }

  async patch(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('PATCH', url, body, headers);
  }

  private request(
    method: string,
    url: string,
    body?: string,
    headers?: Record<string, string>,
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'User-Agent': 'system-scripts-backup/1.0',
          Accept: 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
      };

      const req = client(options, (res) => {
        let data = '';
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
        res.setEncoding('utf8');
        res.on('error', (error: Error) => {
          reject(new Error(`HTTP response error for ${method} ${parsed.host}: ${String(error)}`));
        });
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: data,
            headers,
          });
        });
      });

      // Idle timeout: a connection that stalls mid-transfer rejects instead
      // of hanging the run forever.
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(
          new Error(`HTTP request timed out after ${this.timeoutMs}ms: ${method} ${parsed.host}`),
        );
      });
      req.on('error', reject);

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}
