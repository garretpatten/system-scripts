import { FileSystem } from './types.js';

/**
 * Load a .env file from the project root without overriding variables that are
 * already exported in the current shell.
 */
export async function loadEnvFile(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  projectRoot: string,
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

/**
 * Create or update a single key in the project .env file, preserving all other
 * lines. Used to persist tokens obtained during interactive setup.
 */
export async function saveEnvValue(
  fs: FileSystem,
  projectRoot: string,
  key: string,
  value: string,
): Promise<void> {
  const envFile = `${projectRoot}/.env`;
  const line = `${key}="${value}"`;

  const content = (await fs.exists(envFile)) ? await fs.readFile(envFile) : '';
  const lines = content.split(/\r?\n/);

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  const keyPattern = new RegExp(`^${key}=`);
  const index = lines.findIndex((existing) => keyPattern.test(existing));
  if (index >= 0) {
    lines[index] = line;
  } else {
    lines.push(line);
  }

  await fs.writeFile(envFile, `${lines.join('\n')}\n`);
}
