export function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatRunTimestamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}${s}`;
}

export function formatBackupDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function sanitizeFilename(name: string): string {
  const withoutSlashes = name.replace(/[/\\]/g, '-').replace(/[\r\n]+/g, ' ');
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = withoutSlashes.replace(/[\x00-\x1f]/g, '');
  const trimmed = withoutControlChars.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled';
}

/**
 * Slugifies a GitHub repository name the way GitLab slugifies a project
 * path on creation: lowercase, with each character outside GitLab's
 * allowed set replaced by a hyphen ("My Repo" -> "my-repo").
 */
export function slugifyRepoPath(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
}

export function uniqueFilePath(
  dir: string,
  base: string,
  ext: string,
  exists: (path: string) => boolean,
): string {
  const path = `${dir}/${base}${ext}`;
  if (!exists(path)) {
    return path;
  }
  let counter = 1;
  while (exists(`${dir}/${base}_${counter}${ext}`)) {
    counter++;
  }
  return `${dir}/${base}_${counter}${ext}`;
}
