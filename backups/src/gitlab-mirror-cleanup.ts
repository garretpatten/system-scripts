import { createBackupContext } from './backup-context.js';
import { checkDependencies } from './dependencies.js';
import { FileLogger } from './logger.js';
import { GitHubApiClient } from './github.js';
import { GitLabApiClient } from './gitlab.js';
import { BackupContext } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRunTimestamp, slugifyRepoPath } from './utils.js';

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

    await checkDependencies(this.context.runner, ['git', 'curl'], logger);

    const githubClient = new GitHubApiClient(this.context.http, logger);
    const username = await githubClient.resolveUsername(config.githubUsername, config.githubToken);
    const allRepos = await githubClient.collectRepos(username, config.githubToken, {
      includeArchived: true,
    });
    const githubRepos = allRepos.map((repo) => ({
      fullName: repo.fullName,
      name: repo.name,
      archived: repo.archived,
    }));

    if (githubRepos.length === 0) {
      logger.warn('No GitHub repos found; skipping cleanup to avoid deleting all mirrors');
      return;
    }

    // Match mirrors to GitHub repos by the GitLab project path. Mirrors are
    // created with the GitHub repo *name*, but GitLab auto-slugifies the
    // path (e.g. "My Repo" -> "my-repo"), so accept both the raw name and
    // its slugified form to avoid deleting valid mirrors.
    const githubRepoByKey = new Map<string, { name: string; archived: boolean }>();
    for (const repo of githubRepos) {
      if (!githubRepoByKey.has(repo.name)) {
        githubRepoByKey.set(repo.name, repo);
      }
      const slug = slugifyRepoPath(repo.name);
      if (!githubRepoByKey.has(slug)) {
        githubRepoByKey.set(slug, repo);
      }
    }

    const gitlab = new GitLabApiClient(
      this.context.http,
      logger,
      config.gitlabHost,
      config.gitlabToken,
    );

    const gitlabProjects: Array<{ id: number; path: string; pathWithNamespace: string }> = [];
    for await (const project of gitlab.listProjects(config.gitlabNamespace)) {
      gitlabProjects.push({
        id: project.id,
        path: project.path || path.basename(project.pathWithNamespace),
        pathWithNamespace: project.pathWithNamespace,
      });
    }

    let kept = 0;
    let deleted = 0;
    let failed = 0;

    for (const project of gitlabProjects) {
      const githubRepo = githubRepoByKey.get(project.path);
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
        const message = String(error);
        if (message.includes('already been marked for deletion')) {
          logger.info(`Mirror already scheduled for deletion: ${project.pathWithNamespace}`);
          deleted++;
          continue;
        }
        logger.error(`Failed to delete GitLab project ${project.pathWithNamespace}: ${message}`);
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
}

async function main(): Promise<void> {
  const { context } = await createBackupContext();

  const gitlabToken = process.env.GITLAB_TOKEN;
  const gitlabNamespace = process.env.GITLAB_NAMESPACE;

  if (!gitlabToken) {
    throw new Error('Set GITLAB_TOKEN (GitLab.com PAT) in env or .env');
  }
  if (!gitlabNamespace) {
    throw new Error(
      'Set GITLAB_NAMESPACE (your GitLab username or group full path) in env or .env',
    );
  }

  const config: GitLabMirrorCleanupConfig = {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubUsername: process.env.GITHUB_USERNAME || undefined,
    gitlabToken,
    gitlabNamespace,
    gitlabHost: process.env.GITLAB_HOST || 'https://gitlab.com',
    backupRoot:
      process.env.BACKUP_ROOT || path.join(process.env.HOME || '.', 'GitHub-GitLab-Backup'),
  };

  await new GitLabMirrorCleanup(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
