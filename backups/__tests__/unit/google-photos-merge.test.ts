import { createHash } from 'node:crypto';
import { TakeoutMerger } from '../../src/google-photos-merge.js';
import { PhotosState, StateStore, STATE_FILE_NAME } from '../../src/google-photos-state.js';
import { MockLogger, MockMediaFs } from '../test-helpers.js';

const ROOT = '/slices/_extracted/takeout-001';
const TARGET = '/library';

const SIDECAR = JSON.stringify({
  title: 'IMG_1.jpg',
  creationTime: { timestamp: '1562264582' },
  photoData: { cameraMake: 'Google', cameraModel: 'Pixel 3' },
  description: 'Beach day',
});

describe('TakeoutMerger', () => {
  let mediaFs: MockMediaFs;
  let logger: MockLogger;
  let store: StateStore;
  let merger: TakeoutMerger;
  let state: PhotosState;

  beforeEach(() => {
    mediaFs = new MockMediaFs();
    logger = new MockLogger();
    store = new StateStore(mediaFs, TARGET);
    merger = new TakeoutMerger(mediaFs, logger, store);
    state = StateStore.empty();
    mediaFs.seedFile(`${ROOT}/Takeout/Google Photos/Photos from 2019/IMG_1.jpg`, 'photo-bytes');
    mediaFs.seedFile(
      `${ROOT}/Takeout/Google Photos/Photos from 2019/IMG_1.jpg.supplemental-metadata0.json`,
      SIDECAR,
    );
    mediaFs.seedFile(`${ROOT}/Takeout/Google Photos/VID_1.mp4`, 'video-bytes');
  });

  function hashOf(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async function merge(options = { keepJson: false, dryRun: false }) {
    return merger.merge(ROOT, TARGET, state, options, '2026-10-04');
  }

  it('flattens media into the target and records metadata in state', async () => {
    const counts = await merge();

    expect(counts.scanned).toBe(2);
    expect(counts.copied).toBe(2);
    expect(mediaFs.files.get(`${TARGET}/IMG_1.jpg`)).toBe('photo-bytes');
    expect(mediaFs.files.get(`${TARGET}/VID_1.mp4`)).toBe('video-bytes');

    const item = state.items[hashOf('photo-bytes')];
    expect(item.path).toBe('IMG_1.jpg');
    expect(item.firstSeen).toBe('2026-10-04');
    expect(item.meta.title).toBe('IMG_1.jpg');
    expect(item.meta.creationTime).toBe('2019-07-04T18:23:02.000Z');
    expect(item.meta.cameraMake).toBe('Google');
    expect(item.meta.cameraModel).toBe('Pixel 3');
    expect(item.meta.description).toBe('Beach day');
    expect(item.meta.albums).toEqual(['Photos from 2019']);
  });

  it('deletes nothing from the source but moves media out of the extracted tree', async () => {
    await merge();

    expect(mediaFs.files.has(`${ROOT}/Takeout/Google Photos/Photos from 2019/IMG_1.jpg`)).toBe(
      false,
    );
    // Sidecars are not merged by default and remain in the (later-removed) tree.
    expect(mediaFs.files.has(`${TARGET}/IMG_1.jpg.json`)).toBe(false);
  });

  it('deduplicates identical content within a single run', async () => {
    mediaFs.seedFile(`${ROOT}/Takeout/Google Photos/Photos from 2020/IMG_1.jpg`, 'photo-bytes');

    const counts = await merge();

    expect(counts.copied).toBe(2);
    expect(counts.dedupeSkipped).toBe(1);
    expect(Object.keys(state.items)).toHaveLength(2);
  });

  it('skips content already present in the state manifest', async () => {
    store.register(state, hashOf('photo-bytes'), {
      path: 'IMG_1.jpg',
      size: 11,
      firstSeen: '2026-04-15',
      meta: {},
    });

    const counts = await merge();

    expect(counts.copied).toBe(1);
    expect(counts.dedupeSkipped).toBe(1);
    expect(state.items[hashOf('photo-bytes')].firstSeen).toBe('2026-04-15');
  });

  it('resolves name collisions with a counter suffix', async () => {
    mediaFs.seedFile(`${TARGET}/IMG_1.jpg`, 'different-content');

    const counts = await merge();

    expect(counts.copied).toBe(2);
    expect(mediaFs.files.get(`${TARGET}/IMG_1_1.jpg`)).toBe('photo-bytes');
    expect(mediaFs.files.get(`${TARGET}/IMG_1.jpg`)).toBe('different-content');
    expect(
      logger.messages.some((m) => m.level === 'WARN' && m.message.includes('Name collision')),
    ).toBe(true);
  });

  it('copies JSON sidecars alongside media when keepJson is set', async () => {
    const counts = await merge({ keepJson: true, dryRun: false });

    expect(counts.jsonCopied).toBe(1);
    expect(mediaFs.files.get(`${TARGET}/IMG_1.jpg.json`)).toBe(SIDECAR);
    // VID_1.mp4 has no sidecar, so nothing is copied for it.
    expect(mediaFs.files.has(`${TARGET}/VID_1.mp4.json`)).toBe(false);
  });

  it('supports the legacy <name>.json sidecar naming', async () => {
    mediaFs.files.delete(
      `${ROOT}/Takeout/Google Photos/Photos from 2019/IMG_1.jpg.supplemental-metadata0.json`,
    );
    mediaFs.seedFile(`${ROOT}/Takeout/Google Photos/Photos from 2019/IMG_1.jpg.json`, SIDECAR);

    const counts = await merge();

    expect(counts.copied).toBe(2);
    expect(state.items[hashOf('photo-bytes')].meta.cameraMake).toBe('Google');
  });

  it('ignores JSON files that do not pair with any media file', async () => {
    mediaFs.seedFile(`${ROOT}/Takeout/Google Photos/print-orders.json`, '{}');

    const counts = await merge();

    expect(counts.scanned).toBe(2);
    expect(counts.copied).toBe(2);
    expect(mediaFs.files.has(`${TARGET}/print-orders.json`)).toBe(false);
  });

  it('changes nothing on disk in dry-run mode', async () => {
    const counts = await merge({ keepJson: false, dryRun: true });

    expect(counts.copied).toBe(2);
    expect(mediaFs.files.has(`${TARGET}/IMG_1.jpg`)).toBe(false);
    expect(mediaFs.files.has(`${ROOT}/Takeout/Google Photos/Photos from 2019/IMG_1.jpg`)).toBe(
      true,
    );
    expect(mediaFs.files.has(`${TARGET}/${STATE_FILE_NAME}`)).toBe(false);
    expect(
      logger.messages.some(
        (m) => m.message.includes('[dry-run] copy') && m.message.includes('IMG_1.jpg'),
      ),
    ).toBe(true);
  });

  it('tolerates per-file errors and continues merging', async () => {
    mediaFs.failOnHash = [`${ROOT}/Takeout/Google Photos/VID_1.mp4`];

    const counts = await merge();

    expect(counts.failed).toBe(1);
    expect(counts.copied).toBe(1);
    expect(mediaFs.files.get(`${TARGET}/IMG_1.jpg`)).toBe('photo-bytes');
    expect(
      logger.messages.some((m) => m.level === 'WARN' && m.message.includes('Skipping VID_1.mp4')),
    ).toBe(true);
  });

  it('merges trees that lack the Takeout/ prefix', async () => {
    const altRoot = '/slices/_extracted/takeout-009';
    mediaFs.seedFile(`${altRoot}/Google Photos/IMG_9.jpg`, 'alt-bytes');

    const counts = await merger.merge(
      altRoot,
      TARGET,
      state,
      { keepJson: false, dryRun: false },
      '2026-10-04',
    );

    expect(counts.copied).toBe(1);
    expect(mediaFs.files.get(`${TARGET}/IMG_9.jpg`)).toBe('alt-bytes');
  });

  it('warns and returns zero counts when no media tree exists', async () => {
    const counts = await merger.merge(
      '/empty',
      TARGET,
      state,
      { keepJson: false, dryRun: false },
      '2026-10-04',
    );

    expect(counts.scanned).toBe(0);
    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('No Takeout/Google Photos tree'),
      ),
    ).toBe(true);
  });
});
