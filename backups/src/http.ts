import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { HttpClient, HttpResponse } from './types.js';

export class NodeHttpClient implements HttpClient {
  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('GET', url, undefined, headers);
  }

  async post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('POST', url, body, headers);
  }

  async delete(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('DELETE', url, undefined, headers);
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
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: data,
          });
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}
