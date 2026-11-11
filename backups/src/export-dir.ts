import path from 'node:path';
import { FileSystem, Logger } from './types.js';
import { formatBackupDate } from './utils.js';

export const EXTERNAL_DRIVE_LABEL = 'T7 Shield';
export const DRIVE_EXPORTS_SUBPATH = ['Garret', 'Exports'];

export function formatExportDirName(date: Date): string {
  return `Exports_${formatBackupDate(date)}`;
}

export function resolveLocalExportDir(homeDir: string, date: Date): string {
  return path.join(homeDir, 'Exports', formatExportDirName(date));
}

export async function resolveExternalDriveMount(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const user = env.USER || env.USERNAME || '';
  const candidates = [
    path.join('/Volumes', EXTERNAL_DRIVE_LABEL),
    path.join('/media', user, EXTERNAL_DRIVE_LABEL),
    path.join('/media', EXTERNAL_DRIVE_LABEL),
    path.join('/run/media', user, EXTERNAL_DRIVE_LABEL),
  ];
  for (const candidate of candidates) {
    if (await fs.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveDriveExportDir(mountPoint: string, date: Date): string {
  return path.join(mountPoint, ...DRIVE_EXPORTS_SUBPATH, formatExportDirName(date));
}

export async function moveZipToExportDir(
  fs: FileSystem,
  logger: Logger,
  zipPath: string,
  exportDir: string,
): Promise<string> {
  await fs.mkdir(exportDir, { recursive: true });
  const destination = path.join(exportDir, path.basename(zipPath));
  await fs.copyFile(zipPath, destination);
  await fs.rm(zipPath, { force: true });
  logger.success(`Archive stored in: ${exportDir}`);
  return destination;
}

export async function copyZipToExternalDrive(
  fs: FileSystem,
  logger: Logger,
  zipPath: string,
  driveMountPoint: string,
  date: Date,
): Promise<boolean> {
  const destinationDir = resolveDriveExportDir(driveMountPoint, date);
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
