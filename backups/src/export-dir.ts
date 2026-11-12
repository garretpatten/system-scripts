import path from 'node:path';
import { FileSystem, Logger } from './types.js';
import { formatBackupDate } from './utils.js';

export const EXTERNAL_DRIVE_LABEL = 'T7 Shield';
export const DEFAULT_DRIVE_EXPORTS_SUBPATH = ['Garret', 'Exports'];
export const DRIVE_EXPORTS_SUBPATH_ENV = 'EXTERNAL_DRIVE_EXPORT_SUBPATH';

let driveMountCache: Promise<string | null> | undefined;

export function resetExternalDriveMountCache(): void {
  driveMountCache = undefined;
}

export function formatExportDirName(date: Date): string {
  return `Exports_${formatBackupDate(date)}`;
}

export function resolveLocalExportDir(homeDir: string, date: Date): string {
  return path.join(homeDir, 'Exports', formatExportDirName(date));
}

export function resolveExternalDriveMount(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (!driveMountCache) {
    driveMountCache = probeExternalDriveMount(fs, env);
  }
  return driveMountCache;
}

async function probeExternalDriveMount(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const candidates = [path.join('/Volumes', EXTERNAL_DRIVE_LABEL)];
  const user = env.USER || env.USERNAME || '';
  if (user) {
    candidates.push(path.join('/media', user, EXTERNAL_DRIVE_LABEL));
    candidates.push(path.join('/run/media', user, EXTERNAL_DRIVE_LABEL));
  }
  candidates.push(path.join('/media', EXTERNAL_DRIVE_LABEL));
  for (const candidate of candidates) {
    const stats = await fs.stat(candidate).catch(() => null);
    if (stats?.isDirectory()) {
      return candidate;
    }
  }
  return null;
}

export function resolveDriveExportDir(
  mountPoint: string,
  date: Date,
  env?: NodeJS.ProcessEnv,
): string {
  const override = env?.[DRIVE_EXPORTS_SUBPATH_ENV];
  const subpath = override
    ? override.split('/').filter((segment) => segment.length > 0)
    : DEFAULT_DRIVE_EXPORTS_SUBPATH;
  return path.join(mountPoint, ...subpath, formatExportDirName(date));
}

export async function moveZipToExportDir(
  fs: FileSystem,
  logger: Logger,
  zipPath: string,
  exportDir: string,
): Promise<string> {
  const destination = path.join(exportDir, path.basename(zipPath));
  try {
    await fs.mkdir(exportDir, { recursive: true });
    await fs.rename(zipPath, destination);
    logger.success(`Archive stored in: ${exportDir}`);
    return destination;
  } catch (error) {
    logger.warn(`Failed to move archive into export dir; keeping original path: ${String(error)}`);
    return zipPath;
  }
}

export async function copyZipToExternalDrive(
  fs: FileSystem,
  logger: Logger,
  zipPath: string,
  destinationDir: string,
): Promise<boolean> {
  const destination = path.join(destinationDir, path.basename(zipPath));
  try {
    await fs.mkdir(destinationDir, { recursive: true });
    await fs.copyFile(zipPath, destination);
    logger.success(`Archive copied to external drive: ${destination}`);
    return true;
  } catch (error) {
    logger.warn(`Failed to copy archive to external drive: ${String(error)}`);
    return false;
  }
}

export async function storeArchive(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  zipPath: string,
  homeDir: string,
  date: Date,
): Promise<string> {
  const archivePath = await moveZipToExportDir(
    fs,
    logger,
    zipPath,
    resolveLocalExportDir(homeDir, date),
  );
  const driveMount = await resolveExternalDriveMount(fs, env);
  if (!driveMount) {
    logger.warn(`External drive "${EXTERNAL_DRIVE_LABEL}" not found; skipping external copy`);
    return archivePath;
  }
  await copyZipToExternalDrive(
    fs,
    logger,
    archivePath,
    resolveDriveExportDir(driveMount, date, env),
  );
  return archivePath;
}
