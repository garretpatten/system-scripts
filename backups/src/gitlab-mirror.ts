import { createBackupContext } from './backup-context.js';
import { checkDependencies } from './dependencies.js';
import { FileLogger } from './logger.js';
import { GitHubApiClient, githubTokenAuth } from './github.js';
import { GitLabApiClient, GitLabProtectedBranch } from './gitlab.js';
import { GitLabMirrorCleanup, GitLabMirrorCleanupConfig } from './gitlab-mirror-cleanup.js';
import { BackupContext, GitRemoteAuth, Logger } from './types.js';
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
  private logger!: Logger;

  constructor(private readonly context: BackupContext) {}

  async run(config: GitLabMirrorConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const logDir = path.join(path.dirname(config.backupRoot), 'logs');
    const logFile = path.join(logDir, `gh-gl-backup-${runTs}.log`);
    const errorLog = path.join(logDir, `gh-gl-errors-${runTs}.log`);
    const mirrorsDir = path.join(config.backupRoot, 'mirrors');

    await this.context.fs.mkdir(logDir, { recursive: true });
    await this.context.fs.mkdir(mirrorsDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);
    this.logger = logger;

    logger.info('Starting GitHub -> GitLab backup');
    logger.info(`Local mirrors dir: ${mirrorsDir}`);
    logger.info(`Log: ${logFile}`);

    await checkDependencies(this.context.runner, ['git', 'curl'], logger);

    const githubClient = new GitHubApiClient(this.context.http, logger);
    const username = await githubClient.resolveUsername(config.githubUsername, config.githubToken);
    const allRepos = await githubClient.collectRepos(username, config.githubToken, {
      includeArchived: false,
    });
    const repos = allRepos.map((repo) => ({
      fullName: repo.fullName,
      name: repo.name,
      cloneUrl: config.useSsh ? repo.sshUrl : repo.cloneUrl,
    }));

    let namespaceId: number | undefined;
    if (config.autoCreateProjects) {
      const gitlab = new GitLabApiClient(
        this.context.http,
        logger,
        config.gitlabHost,
        config.gitlabToken,
      );
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

  private async processRepo(
    repo: { fullName: string; name: string; cloneUrl: string },
    mirrorsDir: string,
    config: GitLabMirrorConfig,
    namespaceId: number | undefined,
    logger: Logger,
  ): Promise<boolean> {
    const localPath = path.join(mirrorsDir, `${repo.name}.git`);
    const glPath = `${config.gitlabNamespace}/${repo.name}`;

    logger.info(`Repo: ${repo.fullName}  -> GitLab: ${glPath}`);

    const cloneOptions: { mirror: boolean; auth?: GitRemoteAuth } = { mirror: true };
    if (!config.useSsh && config.githubToken) {
      cloneOptions.auth = githubTokenAuth(config.githubToken);
    }

    try {
      if (await this.context.fs.exists(localPath)) {
        logger.info(`Updating local mirror: ${repo.name}`);
        await this.context.git.remoteUpdate(localPath);
      } else {
        logger.info(`Cloning local mirror: ${repo.name}`);
        await this.context.git.clone(repo.cloneUrl, localPath, cloneOptions);
      }
    } catch (error) {
      logger.error(`Failed to clone/update mirror for ${repo.name}: ${String(error)}`);
      return false;
    }

    const gitlab = new GitLabApiClient(
      this.context.http,
      logger,
      config.gitlabHost,
      config.gitlabToken,
    );

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
          logger.warn(
            `GitLab project missing and auto-create disabled; skipping push: ${repo.name}`,
          );
          return true;
        }
      } else {
        logger.info(`GitLab project exists: ${glPath}`);
      }

      const glUrl = gitlab.buildRemoteUrl(glPath);
      const glAuth = gitlab.remoteAuth();
      logger.info(`Pushing mirror to GitLab (all refs): ${glPath}`);
      try {
        await this.context.git.pushMirror(localPath, glUrl, { auth: glAuth });
      } catch (error) {
        if (!isProtectedBranchForcePushError(String(error))) {
          throw error;
        }
        const healed = await this.pushWithForcePushAllowed(
          gitlab,
          glPath,
          localPath,
          glUrl,
          glAuth,
        );
        if (!healed) {
          throw error;
        }
      }
      logger.success(`Backed up to GitLab: ${glPath}`);
      return true;
    } catch (error) {
      logger.error(`Failed to push mirror to GitLab for ${repo.name}: ${String(error)}`);
      return false;
    }
  }

  /**
   * GitLab protected branches reject force pushes by default, and a mirror
   * push must force-update refs whose history diverged from the source
   * (e.g. after an upstream rewrite). Temporarily enable "Allowed to force
   * push" on the affected branches, retry the push, then restore the
   * original protection.
   */
  private async pushWithForcePushAllowed(
    gitlab: GitLabApiClient,
    glPath: string,
    localPath: string,
    glUrl: string,
    glAuth: GitRemoteAuth,
  ): Promise<boolean> {
    let lockedBranches: GitLabProtectedBranch[] = [];
    try {
      const projectId = await gitlab.getProjectId(glPath);
      if (projectId === null) return false;

      const branches = await gitlab.listProtectedBranches(projectId);
      lockedBranches = branches.filter((branch) => !branch.allowForcePush);
      if (lockedBranches.length === 0) return false;

      this.logger.info(
        `Protected branches block mirror force push; temporarily allowing force push: ${lockedBranches
          .map((branch) => branch.name)
          .join(', ')} (${glPath})`,
      );
      for (const branch of lockedBranches) {
        await gitlab.setProtectedBranchForcePush(projectId, branch.name, true);
      }

      try {
        await this.context.git.pushMirror(localPath, glUrl, { auth: glAuth });
        return true;
      } finally {
        for (const branch of lockedBranches) {
          try {
            await gitlab.setProtectedBranchForcePush(projectId, branch.name, false);
          } catch (restoreError) {
            this.logger.error(
              `Failed to restore force push protection for ${branch.name} on ${glPath}: ${String(
                restoreError,
              )}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to push mirror after allowing force push for ${glPath}: ${String(error)}`,
      );
      return false;
    }
  }
}

function isProtectedBranchForcePushError(message: string): boolean {
  return message.includes('not allowed to force push code to a protected branch');
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

  const config: GitLabMirrorConfig = {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubUsername: process.env.GITHUB_USERNAME || undefined,
    useSsh: (process.env.USE_GITHUB_SSH || 'false').toLowerCase() === 'true',
    gitlabToken,
    gitlabNamespace,
    autoCreateProjects:
      (process.env.AUTO_CREATE_GITLAB_PROJECTS || 'true').toLowerCase() === 'true',
    gitlabVisibility: process.env.GITLAB_VISIBILITY || 'private',
    gitlabHost: process.env.GITLAB_HOST || 'https://gitlab.com',
    backupRoot:
      process.env.BACKUP_ROOT || path.join(process.env.HOME || '.', 'GitHub-GitLab-Backup'),
  };

  await new GitLabMirror(context).run(config);

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
