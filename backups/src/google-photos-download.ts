import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createWriteStream } from 'node:fs';
import { URL } from 'node:url';
import path from 'node:path';
import { Logger } from './types.js';
import { MediaFs } from './google-photos-media-fs.js';
import { sanitizeFilename } from './utils.js';

export const PARTIAL_SUFFIX = '.part';
export const MAX_ATTEMPTS = 3;

export interface HeadResult {
  statusCode: number;
  headers: Record<string, string>;
}

export interface FetchResult {
  statusCode: number;
  bytesWritten: number;
}

/**
 * Transport seam for downloads. The shared `HttpClient` buffers entire
 * response bodies in memory as UTF-8 strings, which is unsuitable for
 * multi-GB Takeout slices, so downloads use this streaming interface.
 */
export interface DownloadTransport {
  head(url: string): Promise<HeadResult>;
  /**
   * Streams url to destPath. When offset > 0 a `Range: bytes=<offset>-`
   * request is made; on a 206 response the bytes are appended, otherwise the
   * file is rewritten from scratch.
   */
  fetchToFile(url: string, destPath: string, offset: number): Promise<FetchResult>;
}

export class NodeDownloadTransport implements DownloadTransport {
  head(url: string): Promise<HeadResult> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: 'HEAD',
          headers: { 'User-Agent': 'system-scripts-backup/1.0' },
        },
        (res) => {
          res.resume();
          res.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(res.headers)) {
              if (value === undefined) continue;
              headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
            }
            resolve({ statusCode: res.statusCode ?? 0, headers });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  fetchToFile(url: string, destPath: string, offset: number): Promise<FetchResult> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const get = parsed.protocol === 'https:' ? httpsGet : httpGet;
      const headers: Record<string, string> = { 'User-Agent': 'system-scripts-backup/1.0' };
      if (offset > 0) {
        headers.Range = `bytes=${offset}-`;
      }

      const req = get(parsed, { headers }, (res) => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 400) {
          res.resume();
          res.on('end', () => reject(new Error(`HTTP ${statusCode} for ${url}`)));
          return;
        }

        // 206 honours the Range request (append); anything else restarts.
        const append = offset > 0 && statusCode === 206;
        const stream = createWriteStream(destPath, { flags: append ? 'a' : 'w' });
        let bytesWritten = 0;
        res.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length;
        });
        res.pipe(stream);
        stream.on('error', reject);
        stream.on('finish', () => resolve({ statusCode, bytesWritten }));
      });
      req.on('error', reject);
    });
  }
}

export type SliceStatus = 'downloaded' | 'skipped' | 'failed';

export interface SliceResult {
  url: string;
  fileName: string;
  status: SliceStatus;
  bytes: number;
  error?: string;
}

export interface DownloadSummary {
  results: SliceResult[];
  downloaded: number;
  skipped: number;
  failed: number;
}

export class TakeoutDownloader {
  constructor(
    private readonly transport: DownloadTransport,
    private readonly mediaFs: MediaFs,
    private readonly logger: Logger,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /**
   * Parses a URL dump (Takeout email or download list). Accepts one URL per
   * line; blank lines and `#` comments are ignored, as are comma-separated
   * URLs pasted inline.
   */
  static parseUrls(text: string): string[] {
    const urls: string[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      for (const candidate of line.split(',')) {
        const url = candidate.trim();
        if (url.length > 0) {
          urls.push(url);
        }
      }
    }
    return urls;
  }

  /**
   * Derives a local file name for a slice URL: the `filename` query
   * parameter when present, otherwise a path segment with a Takeout archive
   * extension, otherwise a deterministic fallback.
   */
  fileNameFor(rawUrl: string, index: number, usedNames: Set<string>): string {
    let name = '';
    try {
      const parsed = new URL(rawUrl);
      const filenameParam = parsed.searchParams.get('filename');
      if (filenameParam) {
        name = path.basename(filenameParam);
      } else {
        const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
        const archiveSegment = segments
          .reverse()
          .find((segment) => /\.(zip|tgz|tar\.gz)$/i.test(segment));
        if (archiveSegment) {
          name = archiveSegment;
        }
      }
    } catch {
      // Fall through to the deterministic name below.
    }

    if (!name) {
      name = `takeout-slice-${String(index + 1).padStart(3, '0')}.zip`;
    }
    name = sanitizeFilename(name);

    let candidate = name;
    let counter = 2;
    while (usedNames.has(candidate)) {
      const dotIndex = name.indexOf('.');
      const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
      const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
      candidate = `${stem}_${counter}${ext}`;
      counter++;
    }
    usedNames.add(candidate);
    return candidate;
  }

  async downloadAll(urls: string[], slicesDir: string): Promise<DownloadSummary> {
    const results: SliceResult[] = [];
    const usedNames = new Set<string>();

    for (const [index, url] of urls.entries()) {
      const fileName = this.fileNameFor(url, index, usedNames);
      const result = await this.downloadSlice(url, slicesDir, fileName);
      results.push(result);
    }

    return {
      results,
      downloaded: results.filter((r) => r.status === 'downloaded').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
  }

  private async downloadSlice(url: string, slicesDir: string, fileName: string) {
    const finalPath = path.join(slicesDir, fileName);
    const partPath = `${finalPath}${PARTIAL_SUFFIX}`;

    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.attemptSlice(url, finalPath, partPath, fileName);
      } catch (error) {
        lastError = String(error);
        this.logger.warn(
          `Slice ${fileName}: attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    this.logger.error(`Slice ${fileName}: FAILED after ${MAX_ATTEMPTS} attempts: ${lastError}`);
    return { url, fileName, status: 'failed' as const, bytes: 0, error: lastError };
  }

  private async attemptSlice(
    url: string,
    finalPath: string,
    partPath: string,
    fileName: string,
  ): Promise<SliceResult> {
    const head = await this.transport.head(url);
    if (head.statusCode >= 400) {
      throw new Error(`HEAD returned HTTP ${head.statusCode}`);
    }
    const contentLength = Number(head.headers['content-length']);
    const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;

    if (total !== null && (await this.mediaFs.exists(finalPath))) {
      const existing = await this.mediaFs.size(finalPath);
      if (existing === total) {
        this.logger.info(`Slice ${fileName}: already downloaded (${total} bytes), skipping`);
        return { url, fileName, status: 'skipped', bytes: total };
      }
      this.logger.warn(
        `Slice ${fileName}: existing file size ${existing} != ${total}, re-downloading`,
      );
      await this.mediaFs.unlink(finalPath);
    }

    let offset = 0;
    if (await this.mediaFs.exists(partPath)) {
      const partSize = await this.mediaFs.size(partPath);
      if (total !== null && partSize > total) {
        this.logger.warn(`Slice ${fileName}: corrupt partial file removed`);
        await this.mediaFs.unlink(partPath);
      } else if (partSize > 0) {
        offset = partSize;
        this.logger.info(`Slice ${fileName}: resuming from byte ${offset}`);
      }
    }

    await this.transport.fetchToFile(url, partPath, offset);

    const downloaded = await this.mediaFs.size(partPath);
    if (total !== null && downloaded !== total) {
      throw new Error(`incomplete download: got ${downloaded} of ${total} bytes`);
    }

    await this.mediaFs.rename(partPath, finalPath);
    this.logger.success(`Slice ${fileName}: downloaded (${downloaded} bytes)`);
    return { url, fileName, status: 'downloaded', bytes: downloaded };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
