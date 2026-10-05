# SPEC: Google Photos Takeout Export Pipeline (Issue 9)

## 1. Summary

Automate the local backup of a multi-year Google Photos library. Since Google's
`photoslibrary.readonly` scope was sunset (March 31, 2025), the only sanctioned
bulk path is **Google Takeout** ("export"). This feature automates everything
after the user clicks "Create export": **download all archive slices with
resume/retry → verify → extract → merge into a flat, deduplicated local
library → keep a hash-based state manifest** so repeat exports (e.g. every 6
months) copy nothing twice.

This is **not** an API backup like `google-tasks`/`google-calendar`: no OAuth
scope is added, it is **not registered in `run-all.ts`** (exports are
user-initiated, not nightly), and archives are multi-GB tarballs — not zips.

## 2. Background & external constraints

- After 2025-03-31, `photoslibrary.readonly`/`photoslibrary` return
  `403 PERMISSION_DENIED`; remaining scopes
  (`photoslibrary.readonly.appcreateddata`) only cover _app-created_ data —
  empty for a personal library. The Picker API requires per-item user
  selection. → **Takeout is the only viable mechanism**; this SPEC must not
  design against the Library API and must not touch `GOOGLE_BACKUP_SCOPES`
  (`backups/src/google-auth.ts`).
- Takeout anatomy: one or more `*.tgz` slices, each containing
  `Takeout/Google Photos/<album>/<media>` plus per-photo metadata
  `<name>.jpg` + `IMG_123.jpg.json` (newer exports:
  `IMG_123.jpg.supplemental-metadata0.json`). Slices are pre-signed
  `https://takeout.googleapis.com/...` URLs supporting HTTP `Range` resume;
  exports expire (~1 week — documented in README).
- Repo conventions honored elsewhere in this spec are established in
  `backups/src/google-tasks-backup.ts`, `backups/src/run-all.ts` (per-step
  pattern), `media-scripts/flatten-photos.sh` (hash dedupe, collision
  `keeper_rank`/`resolve_dest`), and `backups/__tests__/test-helpers.ts`
  (hand-rolled mocks, full-URL response registration).

## 3. Deliverables (files to create/modify)

### New

- `backups/src/google-photos-download.ts` — `TakeoutDownloader`: given slice
  URLs (stdin/file/CLI), fetch with `Range`-resume, exponential backoff
  (3 attempts), partial-file naming `*.tar.part`, final rename on completion;
  skip a slice whose existing file size matches `Content-Length`
- `backups/src/google-photos-takeout.ts` — `TakeoutReader`:
  `listSlices(dir)` → inventory (name, size), `listArchiveEntries(slice)` via
  `tar -tzf`, `extractSlice(slice, destDir)` via `tar`/`unzip`,
  `scanExtracted(dir)` → inventory of media files, JSON sidecars, and album
  folders
- `backups/src/google-photos-state.ts` — `StateStore`: load/save/merge
  `.google-photos-state.json` (schema below); `has(hash)`,
  `register(hash, path, meta)`
- `backups/src/google-photos-merge.ts` — `TakeoutMerger`: flatten-and-dedupe
  into target; sha256 streaming hash; skips hashes already in state or seen
  this run; collision suffix `_1..` mirroring `flatten-photos.sh`
  `resolve_dest`; optional `--keep-json` (default: store metadata in state and
  drop sidecars from the target, matching flatten-photos defaults)
- `backups/src/google-photos-backup.ts` — `GooglePhotosBackup` +
  `GooglePhotosBackupConfig` + `main()` (clone shape of
  `google-tasks-backup.ts`): mode dispatch `download | merge | full`, logging
  via `FileLogger`, disk-space precheck, summary, failing exit code when a
  slice fails
- `backups/google-photos/google-photos-backup.sh` — thin wrapper (verbatim
  pattern of `backups/google-calendar/google-calendar-backup.sh`)
- `backups/google-photos/SPEC.md` — this file
- `backups/__tests__/unit/google-photos-{download,takeout,merge,state,backup}.test.ts`
  — Vitest unit tests using `test-helpers.ts` mocks

### Modified

- `package.json` — `"backup:google-photos": "tsx backups/src/google-photos-backup.ts"`
- `backups/README.md` — Google Photos section: prerequisites (Takeout request
  flow), env vars, CLI flags, output layout, incremental semantics, caveats
  (exports expire; Takeout keeps originals on disk)
- `README.md` — structure list + usage entry
- `AGENTS.md` — layout list: add `backups/google-photos/` (spec + wrapper)
- `.env.example` — `GOOGLE_PHOTOS_TARGET_DIR`, `GOOGLE_PHOTOS_SLICES_DIR` block

**Explicitly unchanged / untouched:** `google-auth.ts`, `run-all.ts`,
`GOOGLE_BACKUP_SCOPES`, no new runtime npm dependencies (uses `node:https`
through `NodeHttpClient`, extracts via system `tar` through
`ProcessCommandRunner` — consistent with `ZipArchive`'s dependence on `zip`).

## 4. Configuration

```bash
GOOGLE_PHOTOS_TARGET_DIR   # default: ~/Pictures/Google Photos
GOOGLE_PHOTOS_SLICES_DIR   # default: ~/Downloads/google-photos-takeout
```

CLI (flags override env):

```text
backups/google-photos/google-photos-backup.sh \
  [--mode download|merge|full] [--urls FILE|url,url,...] \
  [--slices DIR] [--target DIR] [--keep-json] [--dry-run] [--help]
```

`--urls` accepts an email/download-list URL dump file (one per line, `#`
comments ignored). `--mode full` (default) = download → extract → merge.
`--dry-run` prints every would-be copy/move/delete without touching the target.

## 5. State manifest — `.google-photos-state.json` (in target dir)

```json
{
  "version": 1,
  "lastRun": "2026-10-04T12:00:00Z",
  "items": {
    "<sha256>": {
      "path": "IMG_1234.jpg",
      "size": 4820119,
      "firstSeen": "2026-04-15",
      "meta": {
        "title": "IMG_1234.jpg",
        "creationTime": "2019-07-04T21:03:02Z",
        "cameraMake": "...",
        "description": "...",
        "albums": ["..."]
      }
    }
  }
}
```

Written atomically (`.tmp` + rename). Corrupt/missing → treated as empty (full
re-hash pass, no data loss). Incremental guarantee: a repeat run with a fresh
Takeout copies only new hashes; identical-content items are never duplicated on
disk or in state.

## 6. Behavior details

1. **Precheck** — target and slices dirs creatable; free-disk headroom ≥
   extracted-estimate (sum of slice sizes × 3) else `logger.warn` and proceed
   (never abort unless `-noninteractive-would-fail`; `/` root check fails
   fast).
2. **Download** — sequentially (rate-limit friendly), `Content-Length` match ⇒
   skip; `Range` resume on `206`; 3 retries/backoff; per-slice `OK/FAILED`
   logged; failure of one slice does not abort others; final exit code 1 if any
   slice failed (same contract as `run-all.ts` summary).
3. **Extract** — one temp dir per slice under slices dir; `tar -tzf` inventory
   first (counts logged); extracted trees removed after merge (slices kept).
4. **Merge** — walk `Takeout/Google Photos/*` media files; pair `.json`
   sidecars by stem-prefix matching (`X.supplemental-metadata0.json` → `X`);
   hash each file once; new hashes: move (staging dir on same disk → rename)
   into target with collision ranking preferring non-conflict names (reuse
   `keeper_rank` logic); per-file errors logged and skipped, export continues.
5. **Summary** — counts: downloaded/skipped slices, extracted files,
   new/copy-skipped/dedupe-skipped/failed; log filenames
   `backups/logs/google-photos-<ts>.log`, errors to
   `google-photos-errors-<ts>.log` (FileLogger pattern).
6. **Videos, motion photos, edits** — treated as opaque bytes; no transcoding;
   edits arrive as separate files and are separately hashed (correct
   incremental behavior).

## 7. Test matrix (Vitest, mocks only — no network, no real `tar`)

- `google-photos-download.test.ts`: happy path 2 slices (MockHttpClient
  sequence), retry on 5xx then success, Range resume from existing `.part`,
  skips when size matches, malformed URL handling, per-slice failure does not
  abort sibling slices, exit code 1.
- `google-photos-takeout.test.ts`: entry listing & glob filtering (via
  `MockCommandRunner` for `tar -tzf`), JSON sidecar pairing including
  `supplemental-metadata0` naming, album folder enumeration.
- `google-photos-merge.test.ts`: dedupe within run & against pre-seeded state;
  collision suffix sequence; `--keep-json` on/off; `--dry-run` writes nothing;
  state file atomically rewritten; per-file error tolerance.
- `google-photos-backup.test.ts`: config validation errors (same message style
  as calendar/tasks), mode dispatch, summary/fatal logging, log-file paths.
- `google-photos-state.test.ts`: version bump migration (older `version`
  replaced), JSON round-trip, merge-with-existing behavior.

Also: `npm run typecheck`, `npm test` green; `shellcheck` on the wrapper;
`prettier` on touched md/json; `markdownlint` clean.

## 8. Milestones / acceptance criteria

1. **M1 downloader** — `--mode download` fetches a real multi-slice export to a
   local disk with interruption → resume (manual test with 2 slices +
   `kill -INT`); all M1 unit tests green.
2. **M2 extract/inventory** — real tgz slices inspectable; counts match file
   system.
3. **M3 merge + state** — first run of a years-sized library produces flat,
   deduplicated, `flatten-photos.sh`-equivalent output; re-running
   `--mode merge` on same slices completes with `new: 0`.
4. **M4 incremental** — second export (~6 months later) re-run merges only
   delta; state hash count grows monotonically.
5. **M5 docs & CI** — READMEs/AGENTS/.env.example updated; CI linters green;
   README includes Takeout prerequisites step (enable `Google Photos` product
   only, choose 50 GB slice size), expiry warning, and restore caveat list
   (original filenames preserved; live albums not synced; edits arrive as
   separate files).

## 9. Out of scope (boundary)

Browser automation of the Takeout request itself; Library/Picker API backups;
**upload/restore** into Google; any deletion inside Google Photos;
album-structure preservation on disk (flat library + album info in state
manifest metadata only); Google Photos sharing.
