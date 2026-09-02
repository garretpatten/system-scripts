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
}

export class MockCommandRunner implements CommandRunner {
  responses: Map<string, CommandResult> = new Map();
  commands: Array<{ command: string; args: string[]; options?: { cwd?: string } }> = [];

  key(command: string, args: string[]): string {
    return `${command} ${args.join(' ')}`;
  }

  setResponse(command: string, args: string[], result: CommandResult): void {
    this.responses.set(this.key(command, args), result);
  }

  async run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> {
    this.commands.push({ command, args, options });
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
