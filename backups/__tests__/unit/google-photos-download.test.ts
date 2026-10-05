import { TakeoutDownloader } from '../../src/google-photos-download.js';
import { MockDownloadTransport, MockLogger, MockMediaFs } from '../test-helpers.js';

const URL_1 = 'https://takeout.googleapis.com/download?filename=takeout-001.zip&token=abc';
const URL_2 = 'https://takeout.googleapis.com/download?filename=takeout-002.zip&token=def';

describe('TakeoutDownloader', () => {
  let mediaFs: MockMediaFs;
  let transport: MockDownloadTransport;
  let logger: MockLogger;
  let downloader: TakeoutDownloader;

  beforeEach(() => {
    mediaFs = new MockMediaFs();
    transport = new MockDownloadTransport(mediaFs);
    logger = new MockLogger();
    downloader = new TakeoutDownloader(transport, mediaFs, logger, async () => undefined);
  });

  function mockSlice(url: string, content: string): void {
    transport.setHead(url, {
      statusCode: 200,
      headers: { 'content-length': String(Buffer.byteLength(content)) },
    });
    transport.setFetch(url, { bytes: content });
  }

  describe('parseUrls', () => {
    it('parses newline-separated URLs and ignores blanks and comments', () => {
      const text = `# Takeout links\n${URL_1}\n\n${URL_2}\n`;
      expect(TakeoutDownloader.parseUrls(text)).toEqual([URL_1, URL_2]);
    });

    it('parses comma-separated URLs', () => {
      expect(TakeoutDownloader.parseUrls(`${URL_1}, ${URL_2}`)).toEqual([URL_1, URL_2]);
    });
  });

  describe('fileNameFor', () => {
    it('uses the filename query parameter when present', () => {
      expect(downloader.fileNameFor(URL_1, 0, new Set())).toBe('takeout-001.zip');
    });

    it('falls back to a deterministic name for opaque URLs', () => {
      expect(downloader.fileNameFor('not-a-url', 0, new Set())).toBe('takeout-slice-001.zip');
      expect(downloader.fileNameFor('not-a-url', 2, new Set())).toBe('takeout-slice-003.zip');
    });

    it('deduplicates identical names with a counter suffix', () => {
      const used = new Set<string>();
      expect(downloader.fileNameFor(URL_1, 0, used)).toBe('takeout-001.zip');
      const duplicate = downloader.fileNameFor(URL_1, 1, used);
      expect(duplicate).not.toBe('takeout-001.zip');
      expect(duplicate).toContain('takeout-001');
    });
  });

  describe('downloadAll', () => {
    it('downloads two slices into the slices directory', async () => {
      mockSlice(URL_1, 'slice-one-bytes');
      mockSlice(URL_2, 'slice-two-bytes');

      const summary = await downloader.downloadAll([URL_1, URL_2], '/slices');

      expect(summary.downloaded).toBe(2);
      expect(summary.failed).toBe(0);
      expect(mediaFs.files.get('/slices/takeout-001.zip')).toBe('slice-one-bytes');
      expect(mediaFs.files.get('/slices/takeout-002.zip')).toBe('slice-two-bytes');
      expect(mediaFs.files.has('/slices/takeout-001.zip.part')).toBe(false);
    });

    it('skips a slice whose existing file matches Content-Length', async () => {
      mockSlice(URL_1, 'slice-one-bytes');
      mediaFs.seedFile('/slices/takeout-001.zip', 'slice-one-bytes');

      const summary = await downloader.downloadAll([URL_1], '/slices');

      expect(summary.skipped).toBe(1);
      expect(transport.fetchCalls).toHaveLength(0);
      expect(
        logger.messages.some((m) => m.message.includes('already downloaded') && m.level === 'INFO'),
      ).toBe(true);
    });

    it('resumes an interrupted download from the partial file', async () => {
      mockSlice(URL_1, 'slice-one-bytes');
      mediaFs.seedFile('/slices/takeout-001.zip.part', 'slice-');

      const summary = await downloader.downloadAll([URL_1], '/slices');

      expect(summary.downloaded).toBe(1);
      expect(transport.fetchCalls).toHaveLength(1);
      expect(transport.fetchCalls[0].offset).toBe(Buffer.byteLength('slice-'));
      expect(mediaFs.files.get('/slices/takeout-001.zip')).toBe('slice-one-bytes');
    });

    it('retries after a network failure and resumes from partial bytes', async () => {
      mockSlice(URL_1, 'slice-one-bytes');
      transport.setFetch(URL_1, { bytes: 'slice-one-bytes', failOnCall: 1, partialBytes: 6 });

      const summary = await downloader.downloadAll([URL_1], '/slices');

      expect(summary.downloaded).toBe(1);
      expect(transport.fetchCalls).toHaveLength(2);
      expect(transport.fetchCalls[1].offset).toBe(6);
      expect(mediaFs.files.get('/slices/takeout-001.zip')).toBe('slice-one-bytes');
    });

    it('discards a corrupt partial file larger than the total size', async () => {
      mockSlice(URL_1, 'tiny');
      mediaFs.seedFile('/slices/takeout-001.zip.part', 'way-too-many-bytes-here');

      const summary = await downloader.downloadAll([URL_1], '/slices');

      expect(summary.downloaded).toBe(1);
      expect(transport.fetchCalls[0].offset).toBe(0);
      expect(mediaFs.files.get('/slices/takeout-001.zip')).toBe('tiny');
    });

    it('marks a slice failed after all attempts and continues with siblings', async () => {
      transport.setHead('https://broken.example/x.zip', {
        statusCode: 200,
        headers: { 'content-length': '10' },
      });
      // No fetch plan for the broken URL: the mock throws on every attempt.
      mockSlice(URL_2, 'slice-two-bytes');

      const summary = await downloader.downloadAll(
        ['https://broken.example/x.zip', URL_2],
        '/slices',
      );

      expect(summary.failed).toBe(1);
      expect(summary.downloaded).toBe(1);
      expect(summary.results[0].status).toBe('failed');
      expect(summary.results[1].status).toBe('downloaded');
      expect(mediaFs.files.get('/slices/takeout-002.zip')).toBe('slice-two-bytes');
    });

    it('re-downloads an existing slice whose size does not match', async () => {
      mockSlice(URL_1, 'slice-one-bytes');
      mediaFs.seedFile('/slices/takeout-001.zip', 'stale');

      const summary = await downloader.downloadAll([URL_1], '/slices');

      expect(summary.downloaded).toBe(1);
      expect(mediaFs.files.get('/slices/takeout-001.zip')).toBe('slice-one-bytes');
    });

    it('fails cleanly when the server rejects the request', async () => {
      transport.setHead(URL_1, { statusCode: 403, headers: {} });

      const summary = await downloader.downloadAll([URL_1], '/slices');

      expect(summary.failed).toBe(1);
      expect(summary.results[0].error).toContain('403');
    });
  });
});
