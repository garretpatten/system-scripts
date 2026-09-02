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
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRunTimestamp } from './utils.js';

export interface GitLabMirrorCleanupConfig {
  githubToken?: string;
  githubUsername?: string;
  gitlabToken: string;
  gitlabNamespace: string;
  gitlabHost: string;
  backupRoot: string;
}

export class GitLabMirrorCleanup {
  constructor(private readonly context: BackupContext) {}

  async run(config: GitLabMirrorCleanupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const logDir = path.join(path.dirname(config.backupRoot), 'logs');
    const logFile = path.join(logDir, `gh-gl-cleanup-${runTs}.log`);
    const errorLog = path.join(logDir, `gh-gl-cleanup-errors-${runTs}.log`);

    await this.context.fs.mkdir(logDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting GitLab mirror cleanup');
    logger.info(`Log: ${logFile}`);

    await this.checkDependencies(logger);

    const username = await this.resolveUsername(config, logger);
    const githubRepos = await this.fetchRepos(username, config.githubToken, logger);

    if (githubRepos.length === 0) {
      logger.warn('No GitHub repos found; skipping cleanup to avoid deleting all mirrors');
      return;
    }

    const githubRepoByName = new Map(githubRepos.map((repo) => [repo.name, repo]));

    const gitlab = new GitLabApiClient(this.context.http, logger, config.gitlabHost, config.gitlabToken);
    const namespaceId = await gitlab.getNamespaceId(config.gitlabNamespace);
    logger.success(`Resolved GitLab namespace id: ${namespaceId}`);

    const gitlabProjects: Array<{ id: number; name: string; pathWithNamespace: string }> = [];
    for await (const project of gitlab.listProjects(namespaceId)) {
      gitlabProjects.push({
        id: project.id,
        name: path.basename(project.pathWithNamespace),
        pathWithNamespace: project.pathWithNamespace,
      });
    }

    let kept = 0;
    let deleted = 0;
    let failed = 0;

    for (const project of gitlabProjects) {
      const githubRepo = githubRepoByName.get(project.name);
      const shouldDelete = !githubRepo || githubRepo.archived;

      if (!shouldDelete) {
        logger.info(`Keeping mirror: ${project.pathWithNamespace}`);
        kept++;
        continue;
      }

      const reason = githubRepo ? 'archived on GitHub' : 'no matching GitHub repo';
      logger.warn(`Deleting mirror (${reason}): ${project.pathWithNamespace}`);

      try {
        await gitlab.deleteProject(project.id);
        logger.success(`Deleted GitLab project: ${project.pathWithNamespace}`);
        deleted++;
      } catch (error) {
        logger.error(`Failed to delete GitLab project ${project.pathWithNamespace}: ${String(error)}`);
        failed++;
      }
    }

    logger.success('Done.');
    logger.info(`Total GitLab projects: ${gitlabProjects.length}`);
    logger.info(`Kept: ${kept}`);
    logger.info(`Deleted: ${deleted}`);
    logger.info(`Failed: ${failed}`);

    if (failed > 0) {
      logger.warn(`Some projects failed to delete. See: ${errorLog}`);
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

  private async resolveUsername(config: GitLabMirrorCleanupConfig, logger: Logger): Promise<string> {
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
    logger: Logger
  ): Promise<Array<{ fullName: string; name: string; archived: boolean }>> {
    logger.info(`Fetching GitHub repos (including archived) for: ${username}`);
    const client = new GitHubApiClient(this.context.http, logger);
    const repos: Array<{ fullName: string; name: string; archived: boolean }> = [];

    for await (const repo of client.listAllRepos(username, token)) {
      repos.push({
        fullName: repo.fullName,
        name: repo.name,
        archived: repo.archived,
      });
    }

    return repos;
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

  const config: GitLabMirrorCleanupConfig = {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubUsername: process.env.GITHUB_USERNAME || undefined,
    gitlabToken,
    gitlabNamespace,
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

  const cleanup = new GitLabMirrorCleanup(context);
  await cleanup.run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
