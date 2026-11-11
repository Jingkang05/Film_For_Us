# Phase 2 — One template, multiple memories

## Existing architecture

The browser loads `/api/demo`, `/api/preview`, or `/api/a/:id` and mounts the imperative TypeScript viewer. `Album` already carries title, opening letter, roll names/colors, photo dates, captions and image URLs. `darkroom.ts` owns scene transitions, browsing and the liked-photo collection. Envelope and instant-camera motion have separate controllers/configuration; UI translations and language selection are separate from user content.

The editor saves a three-roll draft, uploads images under stable UUIDs, and publishes a snapshot. SQLite is used locally; private Vercel Blob holds the hosted single-album state and media. The album's random share ID is created once and remains its stable viewer ID, even through previously implemented custom suffix changes. The backend and editor contracts remain unchanged by Phase 2.

## Model and boundary

`src/memory-project.ts` defines both the unchanged legacy `Album` contract and the viewer-facing `MemoryProject`:

- `schemaVersion: 1`, `templateId: film-darkroom-v1`, immutable `id`, title.
- Optional description and creation/update timestamps, preserved only when supplied. Legacy snapshots have no such timestamps; none are invented.
- `envelope.message`: the existing letter. Sender/recipient names remain authored in the letter, as in the existing UI. There are no new recipient/sender form controls.
- Three rolls with explicit strip/viewer/instant presentation roles, stable IDs, labels, colors and ordered photo arrays. Photos retain IDs, thumbnail/full URLs, dates and notes. Array order remains the display order; no duplicate numeric ordering field is introduced.
- `ending.instantCaption`: the caption already supported by the instant-camera scene. The drying-line ending is still the current selection; no closing letter or signature UI is invented.
- `settings.sealMotif` and `settings.music`: the existing seal choice and soundtrack configuration. Global translations, UI-language preferences, camera artwork and motion timings remain template concerns, not album-specific content.

`toMemoryProject` validates unknown JSON before mounting. It accepts both legacy responses and the standardized model, creates independent objects, applies the exact previous defaults and rejects missing IDs, duplicate photo IDs, unsupported templates, wrong roll structures and invalid media schemes. It preserves text and storage URLs verbatim. The title's existing default-brand treatment and all visual markup remain unchanged.

`main.ts` keeps the same URL/API selection and passes the adapted model to the same viewer. Invalid/missing data goes through the existing error UI. The editor continues to use `Album`, re-exported through `common.ts` for compatibility. No persistent data migration is needed.

## Local two-album preview

Run `npm run preview:templates`, then visit:

- `http://127.0.0.1:4182/a/demo` — unchanged demo content through the legacy adapter.
- `http://127.0.0.1:4182/a/fixture-memory-b` — synthetic Mira/Rowan letter, different photo IDs/collection and instant-camera caption through the standardized model.

The script binds only to loopback, serves the existing assets and template, and rejects API writes/editor routes. It neither opens a database nor accesses Blob. Fixtures are imported only by this script and tests; no hosted API imports them. This is not a new public album provisioning or upload API.

The existing production snapshot remains in its current store and `/a/OhqQkmPtTAlxEkHH` still uses the existing resolver. Previously shipped slug support is untouched; no new slug feature or redirect is introduced.

## Compatibility and verification

The storage key `roll-for-us:viewer-likes:v1:album:<encoded album ID>` and preview namespace are unchanged. No scene/navigation state is persisted. Restored likes still skip developing; newly selected prints keep the existing developing/hanging flow. Removed photos are filtered and reordering cannot move likes to another ID.

Automated tests cover legacy published snapshots and stable media URLs; two independent models; no shared mutation; invalid input; unchanged Phase 1 keys; reorder/slug-independent preferences; existing HTTP routes; fixture write rejection; and local media/font existence. Existing animation lifecycle, album/upload, owner, URL, translation and collection tests are retained. Build, type check and server syntax checks pass; 33 test cases pass when running `node --test test/*.test.mjs`.

Local browser verification opened both albums from the envelope, confirmed their distinct letters and titles, and confirmed album B's instant-camera caption. No production content, deployment, domain/DNS, editor or Blob configuration was modified. Real production personal content was not copied into fixtures. The legacy snapshot test uses representative data with the original album ID rather than uploading or exposing personal photographs.

## Limits and Phase 3 recommendations

Only the existing three-slot template is supported. The production storage adapter still provisions one album; generic multi-album rendering is proven with local fixture resolution. Description/timestamps have no new UI. Existing CSP may limit externally hosted images/audio; private-media proxy URLs remain the supported production path. Actual iPhone Safari animation behavior should be checked before release.

For Phase 3, wire editor data to this model through a backward-compatible serialization boundary, define persistence for the metadata that currently does not exist, and add publication round-trip tests. Keep album/photo IDs and media paths stable. Decide multi-album storage and ownership requirements separately before implementing them. Do not overwrite fields the editor does not yet understand. No ownership, authentication, dashboard, billing or second template is included here.
