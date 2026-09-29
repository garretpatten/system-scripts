import { HttpClient, Logger } from '../../backups/src/types.js';
import { AlertSeverity, CodeScanningAlert, DependabotAlert, OwnedRepository } from './types.js';

const API_BASE = 'https://api.github.com';

export class GitHubSecurityApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GitHubSecurityApiError';
  }
}

export function normalizeSeverity(raw: string | null): AlertSeverity {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  if (value === 'error') return 'high';
  if (value === 'warning') return 'medium';
  return 'unknown';
}

export function mapDependabotAlert(raw: unknown): DependabotAlert {
  const alert = asRecord(raw);
  const dependency = asRecord(alert.dependency);
  const pkg = asRecord(dependency.package);
  const advisory = asRecord(alert.security_advisory);
  const vulnerability = asRecord(alert.security_vulnerability);
  const patched = asRecord(vulnerability.first_patched_version);

  return {
    number: asNumber(alert.number),
    state: asString(alert.state),
    severity: normalizeSeverity(asString(advisory.severity) || asString(vulnerability.severity)),
    ecosystem: asString(pkg.ecosystem),
    packageName: asString(pkg.name),
    manifestPath: asNullableString(dependency.manifest_path),
    ghsaId: asNullableString(advisory.ghsa_id),
    cveId: asNullableString(advisory.cve_id),
    summary: asString(advisory.summary),
    vulnerableRange: asNullableString(vulnerability.vulnerable_version_range),
    patchedVersion: asNullableString(patched.identifier),
    createdAt: asNullableString(alert.created_at),
    url: asString(alert.html_url),
  };
}

export function mapCodeScanningAlert(raw: unknown): CodeScanningAlert {
  const alert = asRecord(raw);
  const rule = asRecord(alert.rule);
  const tool = asRecord(alert.tool);
  const instance = asRecord(alert.most_recent_instance);
  const location = asRecord(instance.location);

  const securityLevel = asString(rule.security_severity_level);
  const severity = securityLevel
    ? normalizeSeverity(securityLevel)
    : normalizeSeverity(asString(rule.severity));

  return {
    number: asNumber(alert.number),
    state: asString(alert.state),
    severity,
    ruleId: asString(rule.id),
    ruleDescription: asString(rule.description) || asString(rule.full_description),
    tool: asString(tool.name),
    path: asNullableString(location.path),
    startLine: asNumberOrNull(location.start_line),
    createdAt: asNullableString(alert.created_at),
    url: asString(alert.html_url),
  };
}

export class GitHubAlertsClient {
  private static readonly perPage = 100;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly token: string,
  ) {}

  async *listOwnedRepos(): AsyncGenerator<OwnedRepository, void, unknown> {
    let page = 1;
    while (true) {
      const url = `${API_BASE}/user/repos?per_page=${GitHubAlertsClient.perPage}&page=${page}&type=owner&sort=full_name`;
      const response = await this.http.get(url, this.headers());
      const parsed = this.parseArray(response);

      for (const raw of parsed) {
        yield this.mapOwnedRepository(raw);
      }

      if (parsed.length < GitHubAlertsClient.perPage) {
        break;
      }
      page++;
    }
  }

  async listDependabotAlerts(fullName: string): Promise<DependabotAlert[]> {
    const alerts: DependabotAlert[] = [];
    let url = `${API_BASE}/repos/${encodePath(fullName)}/dependabot/alerts?state=open&per_page=${GitHubAlertsClient.perPage}`;

    while (true) {
      const response = await this.http.get(url, this.headers());
      const parsed = this.parseArray(response);

      for (const raw of parsed) {
        alerts.push(mapDependabotAlert(raw));
      }

      const next = this.nextUrlFromLinkHeader(response.headers?.link);
      if (!next) break;
      url = next;
    }

    return alerts;
  }

  async listCodeScanningAlerts(fullName: string): Promise<CodeScanningAlert[]> {
    const alerts: CodeScanningAlert[] = [];
    let page = 1;
    const base = `${API_BASE}/repos/${encodePath(fullName)}/code-scanning/alerts?state=open&per_page=${GitHubAlertsClient.perPage}`;

    while (true) {
      const url = `${base}&page=${page}`;
      const response = await this.http.get(url, this.headers());
      const parsed = this.parseArray(response);

      for (const raw of parsed) {
        alerts.push(mapCodeScanningAlert(raw));
      }

      if (parsed.length < GitHubAlertsClient.perPage) {
        break;
      }
      page++;
    }

    return alerts;
  }

  async getAuthenticatedLogin(): Promise<string> {
    const response = await this.http.get(`${API_BASE}/user`, this.headers());
    const parsed = this.parseBody(response);
    const login = asString(asRecord(parsed).login);
    if (!login) {
      throw new GitHubSecurityApiError('Could not detect GitHub username from token', 200);
    }
    return login;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private mapOwnedRepository(raw: unknown): OwnedRepository {
    const record = asRecord(raw);
    return {
      fullName: asString(record.full_name),
      name: asString(record.name),
      htmlUrl: asString(record.html_url),
      archived: record.archived === true,
      isPrivate: record.private === true,
    };
  }

  private parseArray(response: { statusCode: number; body: string }): unknown[] {
    const parsed = this.parseBody(response);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    throw new GitHubSecurityApiError(
      asString(asRecord(parsed).message) || 'unexpected response',
      response.statusCode,
    );
  }

  private parseBody(response: { statusCode: number; body: string }): unknown {
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      this.logger.error('Invalid JSON response from GitHub API');
      throw new GitHubSecurityApiError('Unexpected response from GitHub API', response.statusCode);
    }
  }

  private nextUrlFromLinkHeader(link: string | undefined): string | null {
    if (!link) {
      return null;
    }
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
  }
}

function encodePath(fullName: string): string {
  return fullName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
