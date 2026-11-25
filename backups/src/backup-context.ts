import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ProcessGitRepository, ProcessSyncClient } from './git.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger } from './logger.js';
import { BackupContext } from './types.js';

/** Resolves the repository root (two levels above backups/src/). */
export function resolveProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  return path.resolve(srcDir, '..', '..');
}

/**
 * Builds the BackupContext shared by every entry point: loads the project
 * .env without overriding exported variables, wires the real
 * implementations, and returns the project root for config resolution.
 * Replaces the ~40-line bootstrap previously copy-pasted into each
 * entry-point main().
 */
export async function createBackupContext(): Promise<{
  context: BackupContext;
  projectRoot: string;
}> {
  const fs = new RealFileSystem();
  const runner = new ProcessCommandRunner();
  const http = new NodeHttpClient();
  const archive = new ZipArchive(runner);

  const projectRoot = resolveProjectRoot();
  await loadEnvFile(fs, process.env, projectRoot);

  const context: BackupContext = {
    logger: new ConsoleLogger(),
    fs,
    http,
    git: new ProcessGitRepository(runner),
    sync: new ProcessSyncClient(runner),
    archive,
    dateProvider: new SystemDateProvider(),
    env: process.env,
    runner,
  };

  return { context, projectRoot };
}
