import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ProcessGitRepository } from './git.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger, FileLogger } from './logger.js';
import { GitHubApiClient } from './github.js';
import { GitLabApiClient } from './gitlab.js';
import { GitLabMirrorCleanup, GitLabMirrorCleanupConfig } from './gitlab-mirror-cleanup.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRunTimestamp } from './utils.js';

export interface GitLabMirrorConfig {
  githubToken?: string;
  githubUsername?: string;
  useSsh: boolean;
  gitlabToken: string;
  gitlabNamespace: string;
  autoCreateProjects: boolean;
  gitlabVisibility: string;
  gitlabHost: string;
  backupRoot: string;
}

export class GitLabMirror {
  constructor(private readonly context: BackupContext) {}

  async run(config: GitLabMirrorConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const logDir = path.join(path.dirname(config.backupRoot), 'logs');
    const logFile = path.join(logDir, `gh-gl-backup-${runTs}.log`);
    const errorLog = path.join(logDir, `gh-gl-errors-${runTs}.log`);
    const mirrorsDir = path.join(config.backupRoot, `mirrors-${runTs}`);

    await this.context.fs.mkdir(logDir, { recursive: true });
    await this.context.fs.mkdir(mirrorsDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting GitHub -> GitLab backup');
    logger.info(`Local mirrors dir: ${mirrorsDir}`);
    logger.info(`Log: ${logFile}`);

    await this.checkDependencies(logger);

    const username = await this.resolveUsername(config, logger);
    const repos = await this.fetchRepos(username, config.githubToken, config.useSsh, logger);

    let namespaceId: number | undefined;
    if (config.autoCreateProjects) {
    const gitlab = new GitLabApiClient(this.context.http, logger, config.gitlabHost, config.gitlabToken);
    namespaceId = await gitlab.getNamespaceId(config.gitlabNamespace);
      logger.success(`Resolved GitLab namespace id: ${namespaceId}`);
    }

    let ok = 0;
    let fail = 0;

    for (const repo of repos) {
      const result = await this.processRepo(repo, mirrorsDir, config, namespaceId, logger);
      if (result) {
        ok++;
      } else {
        fail++;
      }
    }

    logger.success('Done.');
    logger.info(`Total repos processed: ${repos.length}`);
    logger.info(`Successful: ${ok}`);
    logger.info(`Failed: ${fail}`);

    if (fail > 0) {
      logger.warn(`Some repos failed. See: ${errorLog}`);
      process.exitCode = 1;
    }
  }

  private async checkDependencies(logger: Logger): Promise<void> {
    logger.info('Checking dependencies...');
    const deps = ['git', 'curl'];
    const missing: string[] = [];

    for (const dep of deps) {
      const result = await this.context.runner.run(dep, ['--version']);
      if (result.exitCode !== 0) {
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      logger.fatal(`Missing dependencies: ${missing.join(', ')}`);
    }

    logger.success('All dependencies found');
  }

  private async resolveUsername(config: GitLabMirrorConfig, logger: Logger): Promise<string> {
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
  ): Promise<Array<{ fullName: string; name: string; cloneUrl: string }>> {
    logger.info(`Fetching GitHub repos (excluding archived) for: ${username}`);
    const client = new GitHubApiClient(this.context.http, logger);
    const repos: Array<{ fullName: string; name: string; cloneUrl: string }> = [];

    for await (const repo of client.listRepos(username, token)) {
      repos.push({
        fullName: repo.fullName,
        name: repo.name,
        cloneUrl: useSsh ? repo.sshUrl : repo.cloneUrl,
      });
    }

    return repos;
  }

  private async processRepo(
    repo: { fullName: string; name: string; cloneUrl: string },
    mirrorsDir: string,
    config: GitLabMirrorConfig,
    namespaceId: number | undefined,
    logger: Logger
  ): Promise<boolean> {
    const localPath = path.join(mirrorsDir, `${repo.name}.git`);
    const glPath = `${config.gitlabNamespace}/${repo.name}`;

    logger.info(`Repo: ${repo.fullName}  -> GitLab: ${glPath}`);

    let effectiveCloneUrl = repo.cloneUrl;
    if (!config.useSsh && config.githubToken) {
      effectiveCloneUrl = repo.cloneUrl.replace(
        'https://',
        `https://x-access-token:${config.githubToken}@`
      );
    }

    try {
      if (await this.context.fs.exists(localPath)) {
        logger.info(`Updating local mirror: ${repo.name}`);
        await this.context.git.remoteUpdate(localPath);
      } else {
        logger.info(`Cloning local mirror: ${repo.name}`);
        await this.context.git.clone(effectiveCloneUrl, localPath, { mirror: true });
      }
    } catch (error) {
      logger.error(`Failed to clone/update mirror for ${repo.name}: ${String(error)}`);
      return false;
    }

    const gitlab = new GitLabApiClient(this.context.http, logger, config.gitlabHost, config.gitlabToken);

    try {
      const exists = await gitlab.projectExists(glPath);
      if (!exists) {
        if (config.autoCreateProjects) {
          logger.warn(`GitLab project missing, creating: ${glPath}`);
          if (namespaceId === undefined) {
            logger.error(`Could not resolve GitLab namespace id for: ${config.gitlabNamespace}`);
            return false;
          }
          await gitlab.createProject(repo.name, namespaceId, config.gitlabVisibility);
          logger.success(`Created GitLab project: ${glPath}`);
        } else {
          logger.warn(`GitLab project missing and auto-create disabled; skipping push: ${repo.name}`);
          return true;
        }
      } else {
        logger.info(`GitLab project exists: ${glPath}`);
      }

      const glUrl = gitlab.buildRemoteUrl(glPath);
      logger.info(`Pushing mirror to GitLab (all refs): ${glPath}`);
      await this.context.git.pushMirror(localPath, glUrl);
      logger.success(`Backed up to GitLab: ${glPath}`);
      return true;
    } catch (error) {
      logger.error(`Failed to push mirror to GitLab for ${repo.name}: ${String(error)}`);
      return false;
    }
  }
}

async function main(): Promise<void> {
  const fs = new RealFileSystem();
  const runner = new ProcessCommandRunner();
  const http = new NodeHttpClient();
  const git = new ProcessGitRepository(runner);
  const archive = new ZipArchive(runner);
  const dateProvider = new SystemDateProvider();
  const logger = new ConsoleLogger();

  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  const projectRoot = path.resolve(srcDir, '..', '..');

  await loadEnvFile(fs, process.env, projectRoot);

  const gitlabToken = process.env.GITLAB_TOKEN;
  const gitlabNamespace = process.env.GITLAB_NAMESPACE;

  if (!gitlabToken) {
    throw new Error('Set GITLAB_TOKEN (GitLab.com PAT) in env or .env');
  }
  if (!gitlabNamespace) {
    throw new Error('Set GITLAB_NAMESPACE (your GitLab username or group full path) in env or .env');
  }

  const config: GitLabMirrorConfig = {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubUsername: process.env.GITHUB_USERNAME || undefined,
    useSsh: (process.env.USE_GITHUB_SSH || 'false').toLowerCase() === 'true',
    gitlabToken,
    gitlabNamespace,
    autoCreateProjects: (process.env.AUTO_CREATE_GITLAB_PROJECTS || 'true').toLowerCase() === 'true',
    gitlabVisibility: process.env.GITLAB_VISIBILITY || 'private',
    gitlabHost: process.env.GITLAB_HOST || 'https://gitlab.com',
    backupRoot: process.env.BACKUP_ROOT || path.join(process.env.HOME || '.', 'GitHub-GitLab-Backup'),
  };

  const context: BackupContext = {
    logger,
    fs,
    http,
    git,
    sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
    archive,
    dateProvider,
    env: process.env,
    runner,
  };

  const mirror = new GitLabMirror(context);
  await mirror.run(config);

  const cleanupConfig: GitLabMirrorCleanupConfig = {
    githubToken: config.githubToken,
    githubUsername: config.githubUsername,
    gitlabToken: config.gitlabToken,
    gitlabNamespace: config.gitlabNamespace,
    gitlabHost: config.gitlabHost,
    backupRoot: config.backupRoot,
  };
  await new GitLabMirrorCleanup(context).run(cleanupConfig);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
     
    console.error(error);
    process.exit(1);
  });
}

export { main };
