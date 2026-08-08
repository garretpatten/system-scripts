import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ProcessGitRepository, ProcessSyncClient } from './git.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
import { GitHubApiClient } from './github.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface LocalBackupConfig {
  githubToken?: string;
  githubUsername?: string;
  useSsh: boolean;
  homeDir: string;
  logDir: string;
}

export class LocalBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: LocalBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const backupDate = formatBackupDate(date);
    const backupDirName = `Code-Export_${backupDate}`;
    const backupDir = path.join(config.homeDir, backupDirName);
    const logFile = path.join(config.logDir, `code-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    await this.context.fs.mkdir(backupDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting GitHub Projects Local Backup');
    logger.info(`Projects directory: ${backupDir}`);
    logger.info(`Log file: ${logFile}`);

    await this.checkDependencies(logger);

    const username = await this.resolveUsername(config, logger);
    const repos = await this.fetchRepos(username, config.githubToken, config.useSsh, logger);

    if (repos.length === 0) {
      logger.warn('No repositories found');
      return;
    }

    let ok = 0;
    let fail = 0;

    for (const repo of repos) {
      const result = await this.processRepository(repo, backupDir, config, logger);
      if (result) {
        ok++;
      } else {
        fail++;
      }
    }

    await this.createBackup(backupDirName, config.homeDir, logger);

    logger.success('Backup process completed!');
    logger.info(`Total repositories: ${repos.length}`);
    logger.info(`Successful: ${ok}`);
    logger.info(`Failed: ${fail}`);

    if (fail > 0) {
      logger.warn(`Some repositories failed to process. Check error log: ${errorLog}`);
      process.exitCode = 1;
    }
  }

  private async checkDependencies(logger: Logger): Promise<void> {
    logger.info('Checking dependencies...');
    const deps = ['git', 'curl', 'zip'];
    const missing: string[] = [];

    for (const dep of deps) {
      const result = await this.context.runner.run(dep, ['--version']);
      if (result.exitCode !== 0) {
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      logger.fatal(`Missing required dependencies: ${missing.join(', ')}`);
    }

    logger.success('All dependencies found');
  }

  private async resolveUsername(config: LocalBackupConfig, logger: Logger): Promise<string> {
    if (config.githubUsername) {
      logger.success(`Using GitHub username from env: ${config.githubUsername}`);
      return config.githubUsername;
    }

    if (config.githubToken) {
      logger.info('Detecting GitHub username via API (/user)...');
      const client = new GitHubApiClient(this.context.http, logger);
      const user = await client.getAuthenticatedUser(config.githubToken);
      logger.success(`Detected GitHub username: ${user.login}`);
      return user.login;
    }

    logger.fatal('GitHub username is required');
  }

  private async fetchRepos(
    username: string,
    token: string | undefined,
    useSsh: boolean,
    logger: Logger
  ): Promise<Array<{ name: string; cloneUrl: string }>> {
    logger.info(`Fetching GitHub repos (excluding archived) for: ${username}`);
    const client = new GitHubApiClient(this.context.http, logger);
    const repos: Array<{ name: string; cloneUrl: string }> = [];

    for await (const repo of client.listRepos(username, token)) {
      repos.push({
        name: repo.name,
        cloneUrl: useSsh ? repo.sshUrl : repo.cloneUrl,
      });
    }

    return repos;
  }

  private async processRepository(
    repo: { name: string; cloneUrl: string },
    backupDir: string,
    config: LocalBackupConfig,
    logger: Logger
  ): Promise<boolean> {
    const repoPath = path.join(backupDir, repo.name);
    logger.info(`Processing repository: ${repo.name}`);

    if (await this.context.fs.exists(repoPath)) {
      logger.info(`Repository exists, updating: ${repo.name}`);
      return this.updateRepository(repoPath, repo.name, logger);
    }

    logger.info(`Cloning new repository: ${repo.name}`);
    return this.cloneRepository(repo.cloneUrl, repoPath, repo.name, config, logger);
  }

  private async updateRepository(repoPath: string, repoName: string, logger: Logger): Promise<boolean> {
    const result = await this.context.sync.syncRepo(repoPath);

    for (const line of result.output.split('\n')) {
      const clean = line.trim();
      if (!clean) continue;
      if (clean.startsWith('SUCCESS:')) {
        logger.success(clean.replace('SUCCESS:', '').trim());
      } else if (clean.startsWith('WARNING:')) {
        logger.warn(clean.replace('WARNING:', '').trim());
      } else if (clean.startsWith('ERROR:')) {
        logger.error(clean.replace('ERROR:', '').trim());
      } else {
        logger.info(clean);
      }
    }

    if (result.status === 'updated') {
      return true;
    }
    if (result.status === 'uncommitted') {
      logger.warn('Repository was skipped due to uncommitted changes.');
      return true;
    }
    return false;
  }

  private async cloneRepository(
    repoUrl: string,
    repoPath: string,
    repoName: string,
    config: LocalBackupConfig,
    logger: Logger
  ): Promise<boolean> {
    let effectiveUrl = repoUrl;
    if (!config.useSsh && config.githubToken) {
      effectiveUrl = repoUrl.replace('https://', `https://x-access-token:${config.githubToken}@`);
    }

    try {
      await this.context.git.clone(effectiveUrl, repoPath);
      logger.success(`Successfully cloned: ${repoName}`);

      const defaultBranch = await this.context.git.getDefaultBranch(repoPath);
      if (defaultBranch) {
        logger.info(`Checking out default branch: ${defaultBranch}`);
        await this.context.git.checkout(repoPath, defaultBranch).catch(() => {
          logger.warn(`Could not checkout ${defaultBranch} for ${repoName}`);
        });
      } else {
        logger.warn(`Could not determine default branch for ${repoName}. Staying on current branch.`);
      }

      return true;
    } catch (error) {
      logger.error(`Failed to clone: ${repoName}: ${String(error)}`);
      return false;
    }
  }

  private async createBackup(backupDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating backup zip file...');
    const outputFileName = `${backupDirName}.zip`;
    await this.context.archive.zipDirectory(backupDirName, outputFileName, cwd, [
      '*.git/*',
      '*.DS_Store',
      '*.log',
    ]);
    logger.success(`Backup created successfully: ${path.join(cwd, outputFileName)}`);
  }

  get runner() {
    return this.context.runner;
  }
}

async function main(): Promise<void> {
  const fs = new RealFileSystem();
  const runner = new ProcessCommandRunner();
  const http = new NodeHttpClient();
  const git = new ProcessGitRepository(runner);
  const sync = new ProcessSyncClient(runner);
  const archive = new ZipArchive(runner);
  const dateProvider = new SystemDateProvider();
  const logger = new ConsoleLogger();

  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  const projectRoot = path.resolve(srcDir, '..', '..');

  await loadEnvFile(fs, process.env, projectRoot);

  const config: LocalBackupConfig = {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubUsername: process.env.GITHUB_USERNAME || undefined,
    useSsh: (process.env.USE_GITHUB_SSH || 'false').toLowerCase() === 'true',
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(projectRoot, 'backups', 'logs'),
  };

  const context: BackupContext = {
    logger,
    fs,
    http,
    git,
    sync,
    archive,
    dateProvider,
    env: process.env,
    runner,
  };

  const backup = new LocalBackup(context);
  await backup.run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
     
    console.error(error);
    process.exit(1);
  });
}

export { main };
