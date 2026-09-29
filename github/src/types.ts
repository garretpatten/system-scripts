import { DateProvider, FileSystem, HttpClient, Logger } from '../../backups/src/types.js';

export interface SecurityReportContext {
  readonly logger: Logger;
  readonly fs: FileSystem;
  readonly http: HttpClient;
  readonly dateProvider: DateProvider;
}

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface DependabotAlert {
  number: number;
  state: string;
  severity: AlertSeverity;
  ecosystem: string;
  packageName: string;
  manifestPath: string | null;
  ghsaId: string | null;
  cveId: string | null;
  summary: string;
  vulnerableRange: string | null;
  patchedVersion: string | null;
  createdAt: string | null;
  url: string;
}

export interface CodeScanningAlert {
  number: number;
  state: string;
  severity: AlertSeverity;
  ruleId: string;
  ruleDescription: string;
  tool: string;
  path: string | null;
  startLine: number | null;
  createdAt: string | null;
  url: string;
}

export interface OwnedRepository {
  fullName: string;
  name: string;
  htmlUrl: string;
  archived: boolean;
  isPrivate: boolean;
}

export interface RepoAlertsReport {
  fullName: string;
  htmlUrl: string;
  archived: boolean;
  isPrivate: boolean;
  dependabot: DependabotAlert[];
  codeScanning: CodeScanningAlert[];
  warnings: string[];
}

export interface SecurityReportConfig {
  token: string;
  username: string;
  outputDir: string;
  logDir: string;
}

export interface SecurityReportSummary {
  reportPath: string;
  repositoriesScanned: number;
  repositoriesWithAlerts: number;
  dependabotAlerts: number;
  codeScanningAlerts: number;
  warnings: number;
}
