import {
  GooglePhotosBackup,
  GooglePhotosBackupConfig,
  parseArgs,
} from '../../src/google-photos-backup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockDownloadTransport,
  MockFileSystem,
  MockLogger,
  MockMediaFs,
} from '../test-helpers.js';
import { formatRunTimestamp } from '../../src/utils.js';

const RUN_TS = formatRunTimestamp(new Date('2026-10-04T12:00:00Z'));

const URL_1 = 'https://takeout.googleapis.com/download?filename=takeout-slice-001.zip&token=abc';

describe('GooglePhotosBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let mediaFs: MockMediaFs;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let transport: MockDownloadTransport;
  let config: GooglePhotosBackupConfig;

  beforeEach(() => {
    fs = new MockFileSystem();
    mediaFs = new MockMediaFs();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    transport = new MockDownloadTransport(mediaFs);

    context = {
      logger,
      fs,
      http: {
        get: async () => ({ statusCode: 200, body: '' }),
        post: async () => ({ statusCode: 200, body: '' }),
        delete: async () => ({ statusCode: 200, body: '' }),
        patch: async () => ({ statusCode: 200, body: '' }),
      },
      git: {
        clone: async () => undefined,
        remoteUpdate: async () => undefined,
        pushMirror: async () => undefined,
        checkout: async () => undefined,
        getDefaultBranch: async () => null,
      },
      sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
      archive: new MockArchive(),
      dateProvider: new MockDateProvider(new Date('2026-10-04T12:00:00Z')),
      env: {},
      runner,
    };

    runner.setResponse('tar', ['--version'], { stdout: 'tar 1.34', stderr: '', exitCode: 0 });
    runner.setResponse('unzip', ['-v'], { stdout: 'UnZip 6.00', stderr: '', exitCode: 0 });

    config = {
      mode: 'merge',
      urls: [],
      slicesDir: '/slices',
      targetDir: '/library',
      logDir: '/logs',
      keepJson: false,
      dryRun: false,
    };
  });

  function backup(): GooglePhotosBackup {
    return new GooglePhotosBackup(context, mediaFs, transport);
  }

  function mockSliceDownload(): void {
    transport.setHead(URL_1, {
      statusCode: 200,
      headers: { 'content-length': '11' },
    });
    transport.setFetch(URL_1, { bytes: 'slice-bytes' });
  }

  function mockExtraction(): void {
    const slicePath = '/slices/takeout-slice-001.zip';
    const destDir = '/slices/_extracted/takeout-slice-001';
    runner.setResponse('unzip', ['-Z1', slicePath], {
      stdout: 'Takeout/Google Photos/Photos from 2019/IMG_1.jpg',
      stderr: '',
      exitCode: 0,
    });
    runner.setEffect('unzip', ['-q', slicePath, '-d', destDir], () => {
      mediaFs.seedFile(`${destDir}/Takeout/Google Photos/Photos from 2019/IMG_1.jpg`, 'photo');
    });
  }

  it('rejects a root-level target directory', async () => {
    config.targetDir = '/';

    await expect(backup().run(config)).rejects.toThrow('Invalid GOOGLE_PHOTOS_TARGET_DIR');
  });

  it('rejects download mode without URLs', async () => {
    config.mode = 'download';

    await expect(backup().run(config)).rejects.toThrow('No Takeout download URLs provided');
  });

  it('fails fast when tar is missing', async () => {
    runner.setResponse('tar', ['--version'], { stdout: '', stderr: 'not found', exitCode: 1 });

    await expect(backup().run(config)).rejects.toThrow('Missing required dependency: tar');
  });

  it('runs the full pipeline: download, extract, merge, and write state', async () => {
    config.mode = 'full';
    config.urls = [URL_1];
    mockSliceDownload();
    mockExtraction();

    await backup().run(config);

    expect(mediaFs.files.get('/library/IMG_1.jpg')).toBe('photo');
    expect(mediaFs.files.has('/library/.google-photos-state.json')).toBe(true);
    expect(mediaFs.files.has('/slices/_extracted/takeout-slice-001')).toBe(false);
    expect(fs.files.has(`/logs/google-photos-backup-${RUN_TS}.log`)).toBe(true);
    expect(fs.files.has(`/logs/google-photos-errors-${RUN_TS}.log`)).toBe(false);
    expect(logger.messages.some((m) => m.message.includes('Google Photos backup completed'))).toBe(
      true,
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('only downloads in download mode', async () => {
    config.mode = 'download';
    config.urls = [URL_1];
    mockSliceDownload();

    await backup().run(config);

    expect(mediaFs.files.get('/slices/takeout-slice-001.zip')).toBe('slice-bytes');
    expect(
      runner.commands.filter((c) => c.command === 'unzip' && c.args[0] === '-Z1'),
    ).toHaveLength(0);
  });

  it('warns when merge mode finds no slices', async () => {
    await backup().run(config);

    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('No Takeout slices extracted'),
      ),
    ).toBe(true);
    expect(mediaFs.files.has('/library/.google-photos-state.json')).toBe(false);
  });

  it('does not write the state manifest in dry-run mode', async () => {
    config.dryRun = true;
    mediaFs.seedFile('/slices/takeout-slice-001.zip', 'slice-bytes');
    mockExtraction();

    await backup().run(config);

    expect(mediaFs.files.has('/library/.google-photos-state.json')).toBe(false);
    expect(mediaFs.files.has('/library/IMG_1.jpg')).toBe(false);
  });

  it('sets a failing exit code when a slice fails to download', async () => {
    config.mode = 'download';
    config.urls = [URL_1];
    transport.setHead(URL_1, { statusCode: 403, headers: {} });

    try {
      await backup().run(config);

      expect(process.exitCode).toBe(1);
      expect(
        logger.messages.some((m) => m.level === 'WARN' && m.message.includes('failed to download')),
      ).toBe(true);
    } finally {
      process.exitCode = undefined;
    }
  });

  it('warns when disk space looks low', async () => {
    mediaFs.seedFile('/slices/takeout-slice-001.zip', 'x'.repeat(1000));
    mediaFs.freeSpaceBytes = 10;
    mockExtraction();

    await backup().run(config);

    expect(
      logger.messages.some((m) => m.level === 'WARN' && m.message.includes('Low disk space')),
    ).toBe(true);
  });
});

describe('parseArgs', () => {
  it('applies defaults derived from the home directory', () => {
    const config = parseArgs([], {}, '/home/user');

    expect(config.mode).toBe('full');
    expect(config.slicesDir).toBe('/home/user/Downloads/google-photos-takeout');
    expect(config.targetDir).toBe('/home/user/Pictures/Google Photos');
    expect(config.keepJson).toBe(false);
    expect(config.dryRun).toBe(false);
  });

  it('prefers environment variables over defaults', () => {
    const config = parseArgs(
      [],
      { GOOGLE_PHOTOS_SLICES_DIR: '/env/slices', GOOGLE_PHOTOS_TARGET_DIR: '/env/target' },
      '/home/user',
    );

    expect(config.slicesDir).toBe('/env/slices');
    expect(config.targetDir).toBe('/env/target');
  });

  it('lets CLI flags override environment variables', () => {
    const config = parseArgs(
      [
        '--slices',
        '/cli/slices',
        '--target',
        '/cli/target',
        '--mode',
        'merge',
        '--keep-json',
        '--dry-run',
      ],
      { GOOGLE_PHOTOS_SLICES_DIR: '/env/slices' },
      '/home/user',
    );

    expect(config.slicesDir).toBe('/cli/slices');
    expect(config.targetDir).toBe('/cli/target');
    expect(config.mode).toBe('merge');
    expect(config.keepJson).toBe(true);
    expect(config.dryRun).toBe(true);
  });

  it('records the raw --urls value for later resolution', () => {
    const config = parseArgs(['--urls', '/tmp/links.txt'], {}, '/home/user');

    expect(config.urlsFile).toBe('/tmp/links.txt');
    expect(config.urls).toEqual([]);
  });

  it('rejects an invalid mode and unknown options', () => {
    expect(() => parseArgs(['--mode', 'sideways'], {}, '/home/user')).toThrow(
      'Invalid --mode: sideways',
    );
    expect(() => parseArgs(['--nope'], {}, '/home/user')).toThrow('Unknown option: --nope');
    expect(() => parseArgs(['--target'], {}, '/home/user')).toThrow('Missing value for --target');
  });
});
