import { FileSystem } from './types.js';

/**
 * Load a .env file from the project root without overriding variables that are
 * already exported in the current shell.
 */
export async function loadEnvFile(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  projectRoot: string
): Promise<void> {
  const envFile = `${projectRoot}/.env`;

  if (!(await fs.exists(envFile))) {
    return;
  }

  const content = await fs.readFile(envFile);
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2];

    const doubleQuoteMatch = value.match(/^"(.*)"$/);
    const singleQuoteMatch = value.match(/^'(.*)'$/);

    if (doubleQuoteMatch) {
      value = doubleQuoteMatch[1];
    } else if (singleQuoteMatch) {
      value = singleQuoteMatch[1];
    }

    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }
}
