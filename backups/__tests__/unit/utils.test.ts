import {
  formatBackupDate,
  formatRunTimestamp,
  formatTimestamp,
  sanitizeFilename,
  uniqueFilePath,
} from '../../src/utils.js';

describe('utils', () => {
  describe('formatTimestamp', () => {
    it('formats a date as YYYY-MM-DD HH:MM:SS', () => {
      const date = new Date('2024-06-15T08:30:45.000Z');
      expect(formatTimestamp(date)).toBe('2024-06-15 08:30:45');
    });
  });

  describe('formatRunTimestamp', () => {
    it('formats a date as YYYYMMDD-HHMMSS in local time', () => {
      const date = new Date('2024-06-15T08:30:45.000Z');
      const result = formatRunTimestamp(date);
      expect(result).toMatch(/^\d{8}-\d{6}$/);
    });
  });

  describe('formatBackupDate', () => {
    it('formats a date as YYYY-MM-DD', () => {
      const date = new Date('2024-06-15T08:30:45.000Z');
      expect(formatBackupDate(date)).toBe('2024-06-15');
    });
  });

  describe('sanitizeFilename', () => {
    it('replaces slashes with dashes', () => {
      expect(sanitizeFilename('foo/bar')).toBe('foo-bar');
    });

    it('replaces backslashes with dashes', () => {
      expect(sanitizeFilename('foo\\bar')).toBe('foo-bar');
    });

    it('replaces newlines with spaces', () => {
      expect(sanitizeFilename('foo\nbar')).toBe('foo bar');
    });

    it('trims whitespace', () => {
      expect(sanitizeFilename('  foo  ')).toBe('foo');
    });

    it('returns Untitled for empty names', () => {
      expect(sanitizeFilename('   ')).toBe('Untitled');
    });

    it('strips control characters', () => {
      expect(sanitizeFilename('foo\x01bar')).toBe('foobar');
    });
  });

  describe('uniqueFilePath', () => {
    it('returns the original path when it does not exist', () => {
      const exists = () => false;
      expect(uniqueFilePath('/dir', 'file', '.md', exists)).toBe('/dir/file.md');
    });

    it('appends a counter when the original path exists', () => {
      const existing = new Set(['/dir/file.md', '/dir/file_1.md']);
      const exists = (p: string) => existing.has(p);
      expect(uniqueFilePath('/dir', 'file', '.md', exists)).toBe('/dir/file_2.md');
    });
  });
});
