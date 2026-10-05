import { createHash } from 'node:crypto';
import { StateStore, STATE_FILE_NAME } from '../../src/google-photos-state.js';
import { MockMediaFs } from '../test-helpers.js';

describe('StateStore', () => {
  let mediaFs: MockMediaFs;
  let store: StateStore;

  beforeEach(() => {
    mediaFs = new MockMediaFs();
    store = new StateStore(mediaFs, '/library');
  });

  function hashOf(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  it('returns an empty manifest when no state file exists', async () => {
    const state = await store.load();

    expect(state.version).toBe(1);
    expect(state.items).toEqual({});
  });

  it('round-trips a manifest through save and load', async () => {
    const state = StateStore.empty();
    const hash = hashOf('photo-bytes');
    store.register(state, hash, {
      path: 'IMG_1.jpg',
      size: 11,
      firstSeen: '2026-10-04',
      meta: { title: 'IMG_1.jpg', albums: ['Photos from 2019'] },
    });
    state.lastRun = '2026-10-04T12:00:00Z';

    await store.save(state);
    const loaded = await store.load();

    expect(store.has(loaded, hash)).toBe(true);
    expect(loaded.items[hash].path).toBe('IMG_1.jpg');
    expect(loaded.items[hash].meta.albums).toEqual(['Photos from 2019']);
    expect(loaded.lastRun).toBe('2026-10-04T12:00:00Z');
  });

  it('writes atomically via a temporary file that is renamed', async () => {
    await store.save(StateStore.empty());

    const statePath = `/library/${STATE_FILE_NAME}`;
    expect(mediaFs.files.has(statePath)).toBe(true);
    expect(mediaFs.files.has(`${statePath}.tmp`)).toBe(false);
  });

  it('treats a corrupt manifest as empty', async () => {
    mediaFs.seedFile(`/library/${STATE_FILE_NAME}`, 'not json {');

    const state = await store.load();

    expect(state.items).toEqual({});
  });

  it('replaces a manifest from an older version', async () => {
    mediaFs.seedFile(
      `/library/${STATE_FILE_NAME}`,
      JSON.stringify({ version: 0, lastRun: 'x', items: { abc: {} } }),
    );

    const state = await store.load();

    expect(state.version).toBe(1);
    expect(state.items).toEqual({});
  });

  it('reports registered hashes and ignores unknown ones', () => {
    const state = StateStore.empty();
    const hash = hashOf('known');
    store.register(state, hash, {
      path: 'a.jpg',
      size: 1,
      firstSeen: '2026-10-04',
      meta: {},
    });

    expect(store.has(state, hash)).toBe(true);
    expect(store.has(state, hashOf('other'))).toBe(false);
  });
});
