import { createHash } from 'node:crypto';
import {
  Archive,
  CommandResult,
  CommandRunner,
  DateProvider,
  FileSystem,
  GitRepository,
  HttpClient,
  HttpResponse,
  Logger,
  SyncClient,
  SyncResult,
} from '../src/types.js';
import { MediaFs } from '../src/google-photos-media-fs.js';
import { DownloadTransport, FetchResult, HeadResult } from '../src/google-photos-download.js';

export class MockLogger implements Logger {
  messages: Array<{ level: string; message: string }> = [];

  info(message: string): void {
    this.messages.push({ level: 'INFO', message });
  }

  success(message: string): void {
    this.messages.push({ level: 'SUCCESS', message });
  }

  warn(message: string): void {
    this.messages.push({ level: 'WARN', message });
  }

  error(message: string): void {
    this.messages.push({ level: 'ERROR', message });
  }

  fatal(message: string): never {
    this.messages.push({ level: 'FATAL', message });
    throw new Error(message);
  }
}

export class MockFileSystem implements FileSystem {
  files = new Map<string, string>();
  directories = new Set<string>();
  existsPaths = new Set<string>();

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.directories.add(path);
    if (options?.recursive && path.includes('/')) {
      const parts = path.split('/');
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        this.directories.add(current);
      }
    }
  }

  async rm(path: string): Promise<void> {
    this.files.delete(path);
    this.directories.delete(path);
    this.existsPaths.delete(path);
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    this.existsPaths.add(path);
  }

  async appendFile(path: string, data: string): Promise<void> {
    const current = this.files.get(path) ?? '';
    this.files.set(path, current + data);
    this.existsPaths.add(path);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async exists(path: string): Promise<boolean> {
    return this.existsPaths.has(path) || this.directories.has(path);
  }

  async readdir(path: string): Promise<string[]> {
    const entries: string[] = [];
    for (const dir of this.directories) {
      if (dir.startsWith(`${path}/`) && dir !== path) {
        const relative = dir.slice(path.length + 1);
        const firstPart = relative.split('/')[0];
        if (firstPart) entries.push(firstPart);
      }
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(`${path}/`) && file !== path) {
        const relative = file.slice(path.length + 1);
        const firstPart = relative.split('/')[0];
        if (firstPart) entries.push(firstPart);
      }
    }
    return [...new Set(entries)];
  }

  async stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }> {
    return {
      isDirectory: () => this.directories.has(path),
      isFile: () => this.files.has(path),
    };
  }
}

export class MockHttpClient implements HttpClient {
  responses: Map<string, HttpResponse> = new Map();
  responseSequences: Map<string, HttpResponse[]> = new Map();
  requestCounts: Map<string, number> = new Map();
  requests: Array<{ method: string; url: string; headers?: Record<string, string> }> = [];

  setResponse(method: string, url: string, response: HttpResponse): void {
    this.responses.set(`${method}:${url}`, response);
  }

  setResponseSequence(method: string, url: string, responses: HttpResponse[]): void {
    this.responseSequences.set(`${method}:${url}`, responses);
  }

  private getResponse(method: string, url: string): HttpResponse | undefined {
    const key = `${method}:${url}`;
    const sequence = this.responseSequences.get(key);
    if (sequence && sequence.length > 0) {
      const count = this.requestCounts.get(key) ?? 0;
      this.requestCounts.set(key, count + 1);
      return sequence[Math.min(count, sequence.length - 1)];
    }
    return this.responses.get(key);
  }

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    this.requests.push({ method: 'GET', url, headers });
    const response = this.getResponse('GET', url);
    if (!response) {
      throw new Error(`No mock response for GET ${url}`);
    }
    return response;
  }

  async post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    this.requests.push({ method: 'POST', url, headers });
    const response = this.getResponse('POST', url);
    if (!response) {
      throw new Error(`No mock response for POST ${url}: ${body}`);
    }
    return response;
  }

  async delete(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    this.requests.push({ method: 'DELETE', url, headers });
    const response = this.getResponse('DELETE', url);
    if (!response) {
      throw new Error(`No mock response for DELETE ${url}`);
    }
    return response;
  }

  async patch(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    this.requests.push({ method: 'PATCH', url, headers });
    const response = this.getResponse('PATCH', url);
    if (!response) {
      throw new Error(`No mock response for PATCH ${url}: ${body}`);
    }
    return response;
  }
}

export class MockCommandRunner implements CommandRunner {
  responses: Map<string, CommandResult> = new Map();
  effects: Map<string, () => void> = new Map();
  commands: Array<{ command: string; args: string[]; options?: { cwd?: string } }> = [];

  key(command: string, args: string[]): string {
    return `${command} ${args.join(' ')}`;
  }

  setResponse(command: string, args: string[], result: CommandResult): void {
    this.responses.set(this.key(command, args), result);
  }

  /** Registers a side effect (e.g. simulating extracted files) for a command. */
  setEffect(command: string, args: string[], effect: () => void): void {
    this.effects.set(this.key(command, args), effect);
  }

  async run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> {
    this.commands.push({ command, args, options });
    const effect = this.effects.get(this.key(command, args));
    if (effect) {
      effect();
    }
    const response = this.responses.get(this.key(command, args));
    if (!response) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    return response;
  }
}

export class MockGitRepository implements GitRepository {
  clones: Array<{ url: string; path: string; mirror?: boolean }> = [];
  updates: string[] = [];
  pushes: Array<{ path: string; remoteUrl: string }> = [];
  checkouts: Array<{ path: string; branch: string }> = [];
  defaultBranches = new Map<string, string | null>();

  async clone(url: string, path: string, options?: { mirror?: boolean }): Promise<void> {
    this.clones.push({ url, path, mirror: options?.mirror });
  }

  async remoteUpdate(path: string): Promise<void> {
    this.updates.push(path);
  }

  async pushMirror(path: string, remoteUrl: string): Promise<void> {
    this.pushes.push({ path, remoteUrl });
  }

  async checkout(path: string, branch: string): Promise<void> {
    this.checkouts.push({ path, branch });
  }

  async getDefaultBranch(path: string): Promise<string | null> {
    return this.defaultBranches.get(path) ?? null;
  }

  setDefaultBranch(path: string, branch: string | null): void {
    this.defaultBranches.set(path, branch);
  }
}

export class MockSyncClient implements SyncClient {
  results = new Map<string, SyncResult>();

  setResult(path: string, result: SyncResult): void {
    this.results.set(path, result);
  }

  async syncRepo(path: string): Promise<SyncResult> {
    return this.results.get(path) ?? { status: 'failed', output: 'No mock result' };
  }
}

export class MockArchive implements Archive {
  calls: Array<{ sourceDirName: string; outputFileName: string; cwd: string; exclude?: string[] }> =
    [];

  async zipDirectory(
    sourceDirName: string,
    outputFileName: string,
    cwd: string,
    exclude?: string[],
  ): Promise<void> {
    this.calls.push({ sourceDirName, outputFileName, cwd, exclude });
  }
}

export class MockDateProvider implements DateProvider {
  constructor(private readonly date: Date) {}

  now(): Date {
    return new Date(this.date.getTime());
  }
}

export class MockMediaFs implements MediaFs {
  files = new Map<string, string>();
  directories = new Set<string>();
  failOnHash: string[] = [];
  freeSpaceBytes: number | null = null;

  private normalize(p: string): string {
    return p.replace(/\/+/g, '/');
  }

  private addDirRecursive(p: string): void {
    this.directories.add(p);
    const absolute = p.startsWith('/');
    const parts = p.split('/');
    let current = absolute ? '/' : '';
    for (const part of parts) {
      if (!part) continue;
      current = current === '/' || current === '' ? `${current}${part}` : `${current}/${part}`;
      this.directories.add(current);
    }
  }

  async mkdirRecursive(p: string): Promise<void> {
    this.addDirRecursive(this.normalize(p));
  }

  async rmRecursive(p: string): Promise<void> {
    const target = this.normalize(p);
    for (const file of [...this.files.keys()]) {
      if (file === target || file.startsWith(`${target}/`)) {
        this.files.delete(file);
      }
    }
    for (const dir of [...this.directories]) {
      if (dir === target || dir.startsWith(`${target}/`)) {
        this.directories.delete(dir);
      }
    }
  }

  async exists(p: string): Promise<boolean> {
    const target = this.normalize(p);
    return this.files.has(target) || this.directories.has(target);
  }

  async readdirRecursive(root: string): Promise<string[]> {
    const base = this.normalize(root);
    const results: string[] = [];
    for (const file of this.files.keys()) {
      if (file.startsWith(`${base}/`)) {
        results.push(file.slice(base.length + 1));
      }
    }
    return results;
  }

  async size(p: string): Promise<number> {
    const content = this.files.get(this.normalize(p));
    if (content === undefined) {
      throw new Error(`File not found: ${p}`);
    }
    return Buffer.byteLength(content);
  }

  async rename(source: string, destination: string): Promise<void> {
    const src = this.normalize(source);
    const dest = this.normalize(destination);
    const content = this.files.get(src);
    if (content === undefined) {
      throw new Error(`File not found: ${source}`);
    }
    this.files.delete(src);
    this.files.set(dest, content);
    this.addDirRecursive(dest.split('/').slice(0, -1).join('/'));
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const src = this.normalize(source);
    const content = this.files.get(src);
    if (content === undefined) {
      throw new Error(`File not found: ${source}`);
    }
    this.files.set(this.normalize(destination), content);
  }

  async unlink(p: string): Promise<void> {
    this.files.delete(this.normalize(p));
  }

  async readTextFile(p: string): Promise<string> {
    const content = this.files.get(this.normalize(p));
    if (content === undefined) {
      throw new Error(`File not found: ${p}`);
    }
    return content;
  }

  async writeTextFile(p: string, data: string): Promise<void> {
    const target = this.normalize(p);
    this.files.set(target, data);
    this.addDirRecursive(target.split('/').slice(0, -1).join('/'));
  }

  async hashFile(p: string): Promise<string> {
    const content = this.files.get(this.normalize(p));
    if (content === undefined) {
      throw new Error(`File not found: ${p}`);
    }
    if (this.failOnHash.includes(this.normalize(p))) {
      throw new Error(`Simulated hash failure for ${p}`);
    }
    return createHash('sha256').update(content).digest('hex');
  }

  async freeSpace(): Promise<number | null> {
    return this.freeSpaceBytes;
  }

  /** Test helper: seed a file, creating parent directories. */
  seedFile(p: string, content: string): void {
    const target = this.normalize(p);
    this.files.set(target, content);
    this.addDirRecursive(target.split('/').slice(0, -1).join('/'));
  }
}

export interface MockFetchPlan {
  /** Bytes the simulated server holds for this URL. */
  bytes: string;
  statusCode?: number;
  /** Fail with this error on the Nth fetchToFile call (1-based), after writing `partialBytes`. */
  failOnCall?: number;
  partialBytes?: number;
}

export class MockDownloadTransport implements DownloadTransport {
  headResponses = new Map<string, HeadResult>();
  fetchPlans = new Map<string, MockFetchPlan>();
  fetchCalls: Array<{ url: string; destPath: string; offset: number }> = [];
  private fetchCounts = new Map<string, number>();

  constructor(private readonly mediaFs: MockMediaFs) {}

  setHead(url: string, result: HeadResult): void {
    this.headResponses.set(url, result);
  }

  setFetch(url: string, plan: MockFetchPlan): void {
    this.fetchPlans.set(url, plan);
  }

  async head(url: string): Promise<HeadResult> {
    const result = this.headResponses.get(url);
    if (!result) {
      throw new Error(`No mock HEAD response for ${url}`);
    }
    return result;
  }

  async fetchToFile(url: string, destPath: string, offset: number): Promise<FetchResult> {
    this.fetchCalls.push({ url, destPath, offset });
    const plan = this.fetchPlans.get(url);
    if (!plan) {
      throw new Error(`No mock fetch plan for ${url}`);
    }
    const call = (this.fetchCounts.get(url) ?? 0) + 1;
    this.fetchCounts.set(url, call);

    if (plan.failOnCall === call) {
      if (plan.partialBytes && plan.partialBytes > offset) {
        this.mediaFs.seedFile(destPath, plan.bytes.slice(0, plan.partialBytes));
      }
      throw new Error('Simulated network failure');
    }

    const statusCode = plan.statusCode ?? (offset > 0 ? 206 : 200);
    const start = offset > 0 && statusCode === 206 ? offset : 0;
    const chunk = plan.bytes.slice(start);
    if (offset > 0 && statusCode === 206 && this.mediaFs.files.has(destPath)) {
      this.mediaFs.files.set(destPath, (this.mediaFs.files.get(destPath) ?? '') + chunk);
    } else {
      this.mediaFs.seedFile(destPath, chunk);
    }
    return { statusCode, bytesWritten: Buffer.byteLength(chunk) };
  }
}
