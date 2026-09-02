export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult>;
}

export interface HttpResponse {
  statusCode: number;
  body: string;
}

export interface HttpClient {
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse>;
  delete(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
}

export interface FileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
}

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  fatal(message: string): never;
}

export interface Archive {
  zipDirectory(
    sourceDirName: string,
    outputFileName: string,
    cwd: string,
    exclude?: string[],
  ): Promise<void>;
}

export interface DateProvider {
  now(): Date;
}

export interface GitRepository {
  clone(url: string, path: string, options?: { mirror?: boolean }): Promise<void>;
  remoteUpdate(path: string): Promise<void>;
  pushMirror(path: string, remoteUrl: string): Promise<void>;
  checkout(path: string, branch: string): Promise<void>;
  getDefaultBranch(path: string): Promise<string | null>;
}

export interface SyncClient {
  syncRepo(path: string): Promise<SyncResult>;
}

export interface SyncResult {
  status: 'updated' | 'uncommitted' | 'failed';
  output: string;
}

export interface GitHubRepo {
  fullName: string;
  name: string;
  cloneUrl: string;
  sshUrl: string;
  archived: boolean;
}

export interface GitLabProject {
  id: number;
  pathWithNamespace: string;
}

export interface NotionObject {
  id: string;
  object: 'page' | 'database';
  title: string;
  parentId: string | null;
}

export interface NotionBlock {
  id: string;
  type: string;
  hasChildren: boolean;
  [key: string]: unknown;
}

export interface BackupContext {
  logger: Logger;
  fs: FileSystem;
  http: HttpClient;
  git: GitRepository;
  sync: SyncClient;
  archive: Archive;
  dateProvider: DateProvider;
  env: NodeJS.ProcessEnv;
  runner: CommandRunner;
}
