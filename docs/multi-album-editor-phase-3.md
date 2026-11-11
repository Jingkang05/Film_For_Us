# Phase 3 — Multi-album editor

## Architecture assessment

The existing browser editor is imperative TypeScript (`src/manage.ts`); the public experience is one reusable darkroom viewer. Phase 2's `MemoryProject` adapter already preserves legacy IDs, URLs, captions, and presentation defaults. The Node 24 HTTP handler is shared by local development and the Vercel catch-all function. Local persistence was one SQLite album; production was one private Blob JSON state file containing the album, owner password hash, sessions, login attempts, and uploaded-photo IDs. Images are original/thumbnail/full private blobs, delivered through membership-checked API proxies. Production already uses conditional ETag writes.

Extending private Blob is sufficient for a single administrator. There is no new database, service, dependency, billing activation, secret, or filesystem persistence on Vercel. The original album remains in its existing `album` property. Additional albums are separate records in `albums`; each has its own draft, published snapshot, revision, timestamps, status, and upload inventory. A shared collection repository implements both storage adapters.

The production album ID remains `OhqQkmPtTAlxEkHH`. Its existing UUID photo IDs, original private Blob paths, `/a/` ID and slug aliases, proxy URLs, and Phase 1 LocalStorage keys are unchanged. Public scene markup, motion controllers, typography, media optimization, and liked-photo logic are unchanged. The sole `darkroom.ts` edit makes the administrator-only preview return link target its own album editor.

## Data structure

Production retains `roll-for-us/album.json` with this additive structure:

```text
{
  schemaVersion: 2,
  phase3Backup: "roll-for-us/backups/pre-phase-3-<sha256>.json",
  album: <original row, unchanged during conversion>,
  uploaded: <original upload inventory>,
  owner: <existing salted password hash>,
  sessions: <hashed session tokens and expirations>,
  attempts: <persistent login throttling>,
  uploadAttempts: <persistent authenticated upload throttling>,
  albums: [{
    share_id: <immutable random 16-character ID>,
    legacy: false,
    status: "draft" | "published" | "unpublished",
    revision: <optimistic concurrency version>,
    draft: <serialized album content>,
    published: <last public snapshot or null>,
    published_revision: <public version or null>,
    uploaded: [<immutable image asset IDs>],
    createdAt: <ISO timestamp>, updatedAt: <ISO timestamp>
  }]
}
```

The content boundary preserves the legacy `letter`/`shareSlug` contract and adds `description`, `ending.instantCaption`, and `settings` from `MemoryProject`. The editor validates through `toMemoryProject` and saves through `serializeMemoryProject`. The viewer adapts the same stored content through the same model. New albums contain only a generic title, empty letter and rolls, and existing presentation defaults; no production photo or personal text is copied.

Photos remain ordered arrays with stable IDs. Replacements write a new immutable image asset and change only the draft photo's private `assetId` binding. The Photo ID, note, date, and position remain stable. Private asset IDs are omitted from API content. The published snapshot retains its prior binding until Publish. Incoming URLs and asset bindings from an editor payload cannot claim another album's files.

New-album media paths are `roll-for-us/albums/<albumId>/media/<assetId>/{source,thumb,full}`. Existing-album media paths remain `roll-for-us/media/<assetId>/{source,thumb,full}`. Reordering and deletion never rename or delete media.

## Storage and migration

No manual production migration is needed. Reads accept the old state without rewriting it. Before the first metadata mutation, the Blob adapter writes an immutable private snapshot keyed by the original bytes' SHA-256 and reads it back for exact byte comparison. It then conditionally updates the live state using the observed ETag. Backup failure or ETag conflict cannot silently overwrite live state. Conflicts retry against fresh state, while the album's revision rejects stale editor input with HTTP 409.

Production builds also run `scripts/verify-production-storage.mjs`. It verifies the original album ID, stored state, publication snapshot, existing administrator protection, and the presence of original/full/thumbnail files referenced by both snapshots. It writes and verifies a private immutable backup without rewriting live metadata. A failed preflight fails the build before production domain assignment. Only `VERCEL_ENV=production` performs this preflight.

SQLite adds an `album_collection` singleton document table inside the existing database. Initial import reads the old album, media inventory, owner, and sessions in a transaction; all original tables and image bytes are retained. Subsequent metadata updates use `BEGIN IMMEDIATE`. The existing local-to-Blob import script supports either format, preserves namespaced media ownership, clears sessions on import, and refuses a destination containing any existing album state. It is **not** a command to run against this existing production store.

### Reversible recovery procedure

1. Preserve the current state as another verified private backup before recovery. Work only with the authenticated storage SDK/server; backups contain private content and password hashes and must never be committed or served publicly.
2. Read the desired backup and verify its filename SHA-256 against its exact bytes. Check the original album ID and referenced media inventory.
3. Before any Phase 3 album edits, the first conversion can be reversed by restoring the verified pre-conversion document with a conditional ETag write against the latest live state.
4. After Phase 3 use, retain the collection and restore only the selected album record and its upload inventory, preserving other albums, revision concurrency, alias reservations, and status. Review and apply the restoration as a separate authorized maintenance task. Do not restore an entire old document over newer albums or sessions.
5. A code rollback after unpublishing/deletion must retain the Phase 3 status checks. The old single-album adapter does not understand those states and is not a safe rollback target after lifecycle changes.

No recovery command is run by this phase. No stored image is overwritten or deleted.

## Administrator workflows and routes

- `/editor` and `/manage`: album library with title, photo count, publication status, edit, authorized preview, copy link, create, unpublish, and delete.
- `/editor/:albumId`: the existing editor, scoped to one album. It retains uploads, retries, moving between rolls, reordering, notes, dates, colors, custom suffixes and alias history. Replacement is added beside each photo.
- `/preview/:albumId`: administrator-authorized draft content through the same envelope and viewer. Empty/incomplete drafts are allowed. Preview likes use the unchanged separate namespace.
- `/a/:albumId` and existing slug aliases: published snapshot only; anonymous viewing needs no account. Draft changes do not alter the published snapshot. Unpublishing disables both content and media access immediately on subsequent requests.
- Existing `/manage/preview`, `/api/manage`, `/api/preview`, `/api/draft-media`, and original `/api/a/` paths remain supported for the original album.

All new APIs live under `/api/editor`: authenticated GET list, GET album/preview/media, POST create, and per-album POST save/publish/unpublish/delete/upload/upload-target. Existing login/logout/setup endpoints are reused. Save, upload, publication and deletion check the selected album's revision. Publication changes increment that revision, so a stale tab cannot undo a newer lifecycle action.

Deleting an album requires typing its exact ID in a modal and sending that confirmation with the current revision. The repository stores a tombstone, hides the album, disables its public/preview routes, and reserves its published aliases. Original media and metadata remain available for deliberate maintenance recovery. There is no garbage collection or permanent erase action.

The editor protects unsaved edits, in-flight uploads and queued/failed files with navigation warnings. Failed saves keep the editor's current values; conflicts ask for a reload and review. Chinese/English controls remain available. Existing brown surfaces, serif headings, input controls and mobile reflow are reused.

## Security

The existing single-administrator salted-scrypt owner hash or configured server password is reused. Sessions are random, stored by hash, HttpOnly, SameSite=Strict, expire after 12 hours, and use Secure cookies in production. Every administrator read and mutation is checked on the server. All mutations require the configured Origin; setup remains loopback-only. No credential is bundled in client code.

Login throttling is persistent across Vercel instances. Upload throttling is persistent per authenticated session (180 upload-related requests per 15 minutes), in addition to the existing two concurrent image processors per function. Uploads remain limited to 20 MB, 50 megapixels, still JPEG/PNG/WebP, validated by file signature and Sharp decoding. Presigned tokens permit only one immutable private source path for five minutes. Full images remain 1800px WebP quality 88; thumbnails 480px quality 80, with orientation corrected and metadata removed.

Private media is checked against the specific draft or active public snapshot on every request. Responses use `no-store`; unpublishing also revokes media proxies. Previously downloaded viewer copies cannot be recalled. No Blob token, original source, draft media, backup or password hash is exposed through public APIs.

## Verification

Automated coverage includes independent creation/list/edit/delete, owner/origin gates, upload isolation even with overlapping IDs, reordering, replacement while retaining Photo IDs and the prior public image, shared-model serialization, save/reload/restart persistence, failed uploads/saves, ETag races, stale revisions, duplicate IDs, backup failure/corruption, invalid stored state, rate limiting, slug collisions, and publication/unpublish/republish access. Existing Phase 1 likes/collection, envelope animation lifecycle, translation, model and API tests remain included.

Local browser QA uses `node scripts/preview-multi-album.mjs` after build. It creates a disposable temporary SQLite database with only existing public sample photos and never opens `.data` or contacts Blob. The test password printed by that script is local-only. Stop with Ctrl-C to remove its disposable data.

Browser checks cover desktop and 390px mobile library, new empty draft, settings save/reload, private draft preview with a branch seal, exact-ID delete confirmation and rejection, reorder, image replacement, publish feedback, envelope opening, and viewer collection regression. Independent source review required and verified fixes for focus restoration and multibyte request capacity. Visual checks were performed inline; no independent screenshot approval is claimed. Focus is restored after actions by stable album/photo IDs, with the persistent live region retained for announcements. Metadata requests allow up to 2 MiB, verified with 500 maximum-length Chinese captions.

`scripts/verify-public-album.mjs snapshot|compare <private-manifest>` performs read-only production regression checking. Its manifest contains hashes and public paths, not image copies or letter text. It compares the original album's entire canonical content, all Photo IDs, URLs and both optimized image variants byte-for-byte before/after release.

Final command results and deployment evidence are recorded below after release verification.

## Modified and added files

- `server/album.mjs`, `server/blob-album.mjs`, new `server/collection.mjs`: validation, persistent collection repository, safe image versions, backup and concurrency.
- `server/index.mjs`, `vercel.json`: authenticated album routes and page rewrites.
- `src/manage.ts`, new `src/album-library.ts`, `src/editor-focus.ts`, `public/manage.css`: library, per-album editor, settings and replacement.
- `src/memory-project.ts`, `src/common.ts`, `src/main.ts`, `src/darkroom.ts`, `src/ui-translations.ts`: shared serialization, route selection, preview return link and bilingual controls.
- `scripts/migrate-to-vercel.mjs`, new `scripts/verify-production-storage.mjs`, `scripts/verify-public-album.mjs`, `scripts/preview-multi-album.mjs`: import compatibility and repeatable release/QA checks.
- `test/album.test.mjs`, `test/memory-project.test.mjs`, `test/support/memory-model.mjs`, new `test/multi-album.test.mjs`, `test/blob-collection.test.mjs`, `test/legacy-sqlite.test.mjs`, `test/metadata-limits.test.mjs`: regression and new functionality tests.
- `package.json`, `README.md`, this document: build/check commands and operational documentation.

Pre-existing uncommitted typography, envelope, darkroom and font-build edits in the user's workspace are excluded from this phase's commit and deployment.

## Limits and Phase 4 recommendations

This remains a single-administrator collection in one private metadata document, appropriate for the current scale. Writes are atomic across the collection and therefore contend across albums/sessions; the document is capped at 8 MiB, with up to 500 active photos per album. Retained tombstones, orphan uploads and old image variants consume storage until a separately reviewed cleanup feature exists. Persistent state is never written to Vercel's filesystem.

Only the current three-roll template, two existing seal assets and built-in soundtrack are offered. Soundtrack display title is editable; arbitrary audio upload and new templates are outside scope. Actual iPhone Safari behavior is not proven by desktop browser emulation.

For Phase 4, add a maintained authentication provider, server-derived album ownership, owner-scoped list/media/mutation checks, audit history, per-owner quotas, recovery UI and referenced-media garbage collection. Reevaluate transactional metadata storage when multiple owners or document size/write contention justify it; keep public Album/Photo IDs and viewer preference keys stable. No Phase 4 implementation is included.
