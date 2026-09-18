import { Logger } from './types.js';

export const ANSI_COLORS = {
  red: '\u001b[0;31m',
  green: '\u001b[0;32m',
  yellow: '\u001b[1;33m',
  blue: '\u001b[0;34m',
  reset: '\u001b[0m',
};

const SECRET_QUERY_PARAM =
  '(client_secret|refresh_token|access_token|api_key|apikey|token|password)=[^&\\s]+';

const URL_WITH_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi;

/**
 * Masks credential-bearing fragments (URL userinfo such as
 * `https://oauth2:<token>@...` and secret query parameters) so that
 * credentials captured in tool output or error text never reach the console
 * or log files in clear text.
 */
export function redactSecrets(message: string): string {
  return message
    .replace(URL_WITH_USERINFO, (match, scheme: string, userinfo: string) => {
      const colonIndex = userinfo.indexOf(':');
      const masked = colonIndex >= 0 ? `${userinfo.slice(0, colonIndex)}:***` : '***';
      return `${scheme}${masked}@`;
    })
    .replace(new RegExp(SECRET_QUERY_PARAM, 'gi'), '$1=***');
}

export class ConsoleLogger implements Logger {
  constructor(private readonly prefix: string = '') {}

  info(message: string): void {
    this.log('INFO', `${ANSI_COLORS.blue}${message}${ANSI_COLORS.reset}`);
  }

  success(message: string): void {
    this.log('SUCCESS', `${ANSI_COLORS.green}${message}${ANSI_COLORS.reset}`);
  }

  warn(message: string): void {
    this.log('WARN', `${ANSI_COLORS.yellow}${message}${ANSI_COLORS.reset}`);
  }

  error(message: string): void {
    this.log('ERROR', `${ANSI_COLORS.red}${message}${ANSI_COLORS.reset}`);
  }

  fatal(message: string): never {
    this.error(`Fatal: ${message}`);
    throw new Error(message);
  }

  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    const line = `${timestamp} [${level}] ${prefix}${message}`;

    console.error(redactSecrets(line));
  }
}

export class FileLogger implements Logger {
  constructor(
    private readonly baseLogger: Logger,
    private readonly fs: { appendFile(path: string, data: string): Promise<void> },
    private readonly logFile: string,
    private readonly errorLogFile?: string,
  ) {}

  info(message: string): void {
    this.append('INFO', message);
    this.baseLogger.info(message);
  }

  success(message: string): void {
    this.append('SUCCESS', message);
    this.baseLogger.success(message);
  }

  warn(message: string): void {
    this.append('WARN', message);
    this.baseLogger.warn(message);
  }

  error(message: string): void {
    this.append('ERROR', message);
    this.baseLogger.error(message);
  }

  fatal(message: string): never {
    this.append('ERROR', `Fatal: ${message}`);
    this.baseLogger.fatal(message);
  }

  private append(level: string, message: string): void {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const line = `${timestamp} [${level}] ${redactSecrets(message)}\n`;
    this.fs.appendFile(this.logFile, line).catch(() => undefined);
    if (level === 'ERROR' && this.errorLogFile) {
      this.fs.appendFile(this.errorLogFile, line).catch(() => undefined);
    }
  }
}
