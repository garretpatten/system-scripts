import { CommandRunner, GitRepository, SyncClient, SyncResult } from './types.js';

export class ProcessGitRepository implements GitRepository {
  constructor(private readonly runner: CommandRunner) {}

  async clone(url: string, path: string, options?: { mirror?: boolean }): Promise<void> {
    const args = options?.mirror ? ['clone', '--mirror', url, path] : ['clone', url, path];
    const result = await this.runner.run('git', args);
    if (result.exitCode !== 0) {
      throw new Error(`git clone failed: ${result.stderr}`);
    }
  }

  async remoteUpdate(path: string): Promise<void> {
    const result = await this.runner.run('git', ['-C', path, 'remote', 'update', '--prune']);
    if (result.exitCode !== 0) {
      throw new Error(`git remote update failed: ${result.stderr}`);
    }
  }

  async pushMirror(path: string, remoteUrl: string): Promise<void> {
    const result = await this.runner.run('git', ['-C', path, 'push', '--mirror', remoteUrl]);
    if (result.exitCode !== 0) {
      throw new Error(`git push mirror failed: ${result.stderr}`);
    }
  }

  async checkout(path: string, branch: string): Promise<void> {
    const result = await this.runner.run('git', ['-C', path, 'checkout', branch]);
    if (result.exitCode !== 0) {
      throw new Error(`git checkout failed: ${result.stderr}`);
    }
  }

  async getDefaultBranch(path: string): Promise<string | null> {
    const result = await this.runner.run('git', [
      '-C',
      path,
      'rev-parse',
      '--abbrev-ref',
      'origin/HEAD',
    ]);
    if (result.exitCode !== 0 || !result.stdout) {
      return null;
    }
    const match = result.stdout.match(/origin\/(.*)/);
    return match?.[1] ?? null;
  }
}

export class ProcessSyncClient implements SyncClient {
  constructor(private readonly runner: CommandRunner) {}

  async syncRepo(path: string): Promise<SyncResult> {
    const status = await this.runner.run('git', ['-C', path, 'status', '--porcelain']);
    if (status.exitCode !== 0) {
      return { status: 'failed', output: `ERROR: status check failed\n${status.stderr}` };
    }
    if (status.stdout.trim().length > 0) {
      return {
        status: 'uncommitted',
        output: `WARNING: Repository has uncommitted changes`,
      };
    }

    const fetch = await this.runner.run('git', ['-C', path, 'fetch', '--prune']);
    if (fetch.exitCode !== 0) {
      return { status: 'failed', output: `ERROR: fetch failed\n${fetch.stderr}` };
    }

    const defaultBranch = await this.getDefaultBranch(path);
    if (!defaultBranch) {
      return { status: 'failed', output: 'ERROR: Could not determine default branch' };
    }

    const pull = await this.runner.run('git', ['-C', path, 'pull', 'origin', defaultBranch]);
    if (pull.exitCode !== 0) {
      return { status: 'failed', output: `ERROR: pull failed\n${pull.stderr}` };
    }

    return { status: 'updated', output: `SUCCESS: Updated ${path}` };
  }

  private async getDefaultBranch(path: string): Promise<string | null> {
    const result = await this.runner.run('git', [
      '-C',
      path,
      'rev-parse',
      '--abbrev-ref',
      'origin/HEAD',
    ]);
    if (result.exitCode !== 0 || !result.stdout) {
      return null;
    }
    const match = result.stdout.match(/origin\/(.*)/);
    return match?.[1] ?? null;
  }
}
