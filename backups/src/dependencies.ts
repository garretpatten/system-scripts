import { CommandRunner, Logger } from './types.js';

/**
 * Verifies that external commands are installed by invoking
 * `<command> --version`. Logs and throws (via logger.fatal) when any are
 * missing. Shared by the backup entry points, which previously each carried
 * their own copy of this check.
 */
export async function checkDependencies(
  runner: CommandRunner,
  deps: string[],
  logger: Logger,
): Promise<void> {
  logger.info('Checking dependencies...');
  const missing: string[] = [];

  for (const dep of deps) {
    const result = await runner.run(dep, ['--version']);
    if (result.exitCode !== 0) {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    const label = missing.length === 1 ? 'dependency' : 'dependencies';
    logger.fatal(`Missing required ${label}: ${missing.join(', ')}`);
  }

  logger.success('All dependencies found');
}
