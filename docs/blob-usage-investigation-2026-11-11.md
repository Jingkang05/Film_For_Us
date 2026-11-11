# Film for us: Blob usage investigation, 11 November 2026

## Diagnosis

Two confirmed amplification mechanisms exist: an uncached read of the entire shared `album.json` for every media request, and a Phase 3 production-build preflight that calls `head()` on three variants of every legacy asset. Browser image responses use `no-store`, making repeated image loads reach the function again. This is sufficient to explain substantial usage without an infinite loop. It does not establish the exact attribution of the reported 9,653 operations.

The reported usage (9,653/10,000, 347 remaining) and store name `roll-for-us-private` come from the user. This audit did not independently retrieve the monthly store counter. Application paths default to the `roll-for-us` prefix; that prefix is distinct from the store name. No production Blob object was fetched, listed, changed, or deleted during this investigation. No application deployment or configuration change was made.

## Confirmed production evidence

Project: `roll-for-us` (scope from `.vercel/project.json`, matched by deployment records; account identifiers omitted).

The following successful production builds each logged `publishedPhotos:29` and `verifiedAssets:29`:

| Deployment | Source | Preflight `head()` calls implied by executed code |
| --- | --- | ---: |
| [Phase 3](https://vercel.com/jk-940b/roll-for-us/2tJMRJ8RDWQHQnj4VnC3LmihrBKp) | `9365947` | 87 |
| [Optional dates](https://vercel.com/jk-940b/roll-for-us/67Nst6x2KnJsmZaUazGF7fMWS6nR) | `be6bfee` | 87 |
| [HEIC support](https://vercel.com/jk-940b/roll-for-us/A97VCsEU3D19Mm4ZfxoAsk8uAvGc) | `5120c185` merge of feature `4bcfed0` | 87 |

Together these builds executed 261 metadata checks. Each also reads current state and a checksum-addressed backup with caching disabled; creating a missing backup adds another read and a write. Ordinary successful preflight accounting is therefore 89–90 read/check calls per build, or 267–270 across these three builds, excluding retries. The 261 `head()` calls are the firm Simple Operations component; exact billing treatment of missing-object reads is not established here.

The returned deployment inventory contained 35 records: on November 11, nine READY production and six READY preview deployments; on November 7, seventeen READY production and three BLOCKED production records. Dates use Asia/Kuala_Lumpur. Only the three production builds above are confirmed to run the new scan. Do not multiply 87 by every deployment: previews skip it and older builds predate it.

Build backup hashes differed across these three builds. The helper keys backups by the whole state, which includes sessions, throttling and draft data. Consequently ordinary state changes can cause a new backup on a later build even when published photographs are unchanged. It also means the existing build is not strictly read-only: it may create backup blobs.

## Complete access inventory

| Code path | Access and trigger | Assessment |
| --- | --- | --- |
| `server/blob-album.mjs:16` `read()` | `get(album.json, useCache:false)`; also used for backups | Primary repeated uncached read. SDK 2.8.2 adds `?cache=0` and makes a direct GET; it does not perform an implicit `head()`. |
| `snapshot()` | Calls `read()` on each invocation; missing state can initialize it | No warm-instance state cache or deduplication. Used for public content, media, owner/session lookup, library, upload checks and mutations. |
| `change()` | Up to six fresh snapshots and conditional writes | Bounded contention retry, not polling. Backup checks can repeat during initial conversion/conflicts. Never remove fresh ETags from writes. |
| `backup()` | Uncached backup existence/readback; conditional error fallback reads | Usually 1 backup GET if present, 2 if newly created; PUT only if missing. Runs during first conversion and every production preflight. |
| `writeMedia()` | PUT thumb/full; on PUT failure, uncached GET to compare bytes | Error/retry path only. No normal viewer metadata checks here. |
| `readMedia()` | Default-cache private GET of thumb/full | CDN eligible already. The extra state read before it is uncached. |
| `verifyExisting()` | Current state + backup + `head(source/thumb/full)` for every unique legacy draft/published asset | New Phase 3 scan, automatically invoked by `pnpm build` in production. Deduplicates asset IDs, but still three paid checks per asset on every build. Checks only the legacy album, not every new album. |
| `uploadTarget()` | `checkUpload()` snapshot, `hasUpload()` snapshot, one source `head()` | Two redundant state snapshots before signing; metadata HEAD was present before Phase 3. Keep duplicate-upload protection. |
| `uploadSource()` | Snapshot to locate album, then uncached source GET | New extra lookup in Phase 3. Source GET is appropriate for processing; not a viewer request. |
| `scripts/migrate-to-vercel.mjs` | Uncached state reads and writes when manually invoked | Migration utility, not a route or build dependency; execution history unproven. Not run in this audit. |
| `scripts/verify-public-album.mjs` | One album JSON GET and thumb/full GET for every photo, all through production API | Added in Phase 3; manual snapshot/compare utility, not automatically invoked by build. Each run on 29 photos creates 59 uncached state reads and up to 58 image origin misses. A snapshot+compare pair doubles this. Its historical invocation count is unknown. Not run in this audit. |
| `src/manage.ts` direct upload | Presigned URL PUT of source | Only direct browser Blob access found in application source. Upload is an Advanced Operation, not a Simple Operation. Signing is separate from fetching file bytes. |
| `previews/chinese-prompts/server.mjs` | Proxies requests to production API | Development preview can consume production reads if used; not automatically invoked by production. Historical use unknown. |
| `collectionStore.list()` | Reads the one JSON state and maps album summaries | This is an application method, not `@vercel/blob.list()`. No per-album storage listing. |

No SDK `list()` call or direct browser Blob GET was found in application code. Vercel bills `list()` as Advanced Operations. `head()` and origin/cache-miss URL access are Simple Operations; Blob CDN hits do not count as Simple Operations. See [Blob operation accounting](https://vercel.com/docs/vercel-blob/usage-and-pricing).

## One-album accounting and repeated frontend requests

The synthetic audit script `scripts/audit-blob-operations-offline.mjs` uses the real handler and Blob adapter with an injected in-memory store. It replaces global fetch with a throwing stub. All eight scenario assertions passed using Node 24.22.1; no production requests were made. Counts represent application storage calls, not measured billing or a browser trace.

| Scenario | Uncached state/backup GETs | CDN-eligible image GETs | HEADs |
| --- | ---: | ---: | ---: |
| Fetch album JSON for sealed envelope | 1 | 0 | 0 |
| Display viewer frame, thumb + full | 2 | 2 | 0 |
| Repeat same frame through API | 2 | 2 | 0 |
| JSON + both variants of all 29 photos | 59 | 58 | 0 |
| One editor thumbnail, environment password | 2 | 1 | 0 |
| One editor thumbnail, stored owner password | 3 | 1 | 0 |
| Build preflight, new backup | 3 | 0 | 87 |
| Build preflight, existing backup | 2 | 0 | 87 |

Opening the sealed envelope alone does not eagerly load all album media. `src/main.ts` fetches one content document; initial envelope rendering does not reference album photographs. Static envelope graphics, fonts and soundtrack are in `public`, not Blob.

For M public image requests, normal application accounting is 1+M uncached state GETs, plus M cache-eligible image GETs. A synthetic pass over all 29 photos and both variants thus costs roughly 59 Simple Operations with warm image CDN cache, up to 117 if all 58 image reads miss. This is a scenario, not a claim that every visitor loads both variants of all photographs.

Frontend amplification is event-driven:

- `src/darkroom.ts:540` creates a thumbnail and a full image for each viewer update. The thumb is replaced when full loads. Reopening/advancing/returning can repeat these URLs.
- Film galleries reference thumbnails; some use lazy loading. Modal previews create a thumb and then full; drying-line rendering recreates thumbnail elements for saved/hung prints. Full-scene `innerHTML` replacement recreates images.
- `src/manage.ts` rebuilds the editor after actions and repeatedly during each upload. Already-visible thumbnails can request again because responses cannot be cached. If K thumbnails are reached on each of B renders, image request amplification can approach K×B; exact browser behavior/count is unmeasured. Each authenticated image also reads session state and may read the stored owner.
- `src/polaroid.ts:181` preloads only the next two images. Its `prepared` Map deduplicates within that mounted instance; leaving/reentering recreates it. Error fallback tries a thumbnail once. No unbounded image retry loop found.
- Viewer likes use localStorage. There is no server write/poll per heart toggle. Restoring many likes can cause many thumbnail requests when opening the saved-print collection, not at initial envelope load.
- Existing `pageshow` handling reloads on back/forward-cache restoration. This can add one new content request per such navigation; it is not a timer loop.
- No recurring network polling or `setInterval` was found. The darkroom timeout controls development animation. The upload loop processes user-selected files sequentially, not indefinitely. `api()` performs one fetch and no automatic retry.

## Private delivery and cache diagnosis

Every image response from `server/index.mjs` inherits `Cache-Control: no-store`. There is no image ETag/304 handling or application image cache. This blocks browser storage and function-response CDN caching. Separately, `readMedia()` leaves Blob CDN caching enabled; image bytes can therefore hit the Blob CDN even when the browser must contact the function again.

However `collectionStore.media()` always calls `snapshot()` first to enforce current publication and photo membership. That state read bypasses Blob CDN even on an image-byte HIT. Authenticated editor paths add `localOwner()` when needed, then `sessionValid()`, then another snapshot inside `media()`.

[Vercel's private storage guidance](https://vercel.com/docs/vercel-blob/private-storage) distinguishes these cache layers and describes private browser revalidation with ETags. [Consistent reads](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage) confirms `useCache:false` bypasses the CDN. Changing only the image response to `private, no-cache`/304 would reduce transferred bytes, but would still need fresh publication/session checks and therefore would not eliminate the main state operation. Giving private image responses long freshness or public `s-maxage` would change revocation/privacy behavior.

## Commit comparison and timing

- The November 7 implementation (`3315a74`, also represented in baseline `61c38e4`) already has uncached state snapshots and media authorization per image. The later baseline `fe6e2b7` preserves that pattern. This predates all three phases and is a plausible mechanism for November 6–8 usage; local history alone does not establish which exact code ran on November 6.
- Phase 1 (`90bf897`, `ce84168`) adds local likes and saved-print rendering. No new backend polling or Blob calls. Additional collection viewing can increase media requests.
- Phase 2 (`a03be9c`) adapts the frontend model; no Blob adapter change. No storage-operation regression identified in that refactor.
- Phase 3 (`bf53368`, production merge `9365947`) introduces the build scan and full production regression utility, plus redundant upload-state reads and persistent upload-throttling state mutations. All albums still share one uncached state blob.
- Optional dates (`f322ea1`) and HEIC (`4bcfed0`) introduce no new viewer Blob calls; their production rebuilds nevertheless repeat the Phase 3 scan.

## Evidence limitations and hypotheses

Historical runtime-log query for November 6–11 was rejected: Hobby retains only one hour. A bounded latest-50-minute query returned no runtime-log groups; that does not prove zero requests, because successful handlers emit no operation-level console logs. Billing charges returned `404 costs_not_found`; the general observability schema exposed request/function/external-API metrics but no store Simple Operations metric. An attempted external-request aggregate returned HTTP 400 and supplied no usable traffic evidence. CLI was not installed. No plan, billing, drain, or observability configuration was changed.

Therefore exact daily totals, image CDN HIT/MISS ratios, number of historical public-regression runs, November 6–8 visitor/upload volume, and client reload counts remain unknown. Dashboard object browsing can also incur operations per Vercel documentation, but this user's object browsing is not proven. Bots/unauthorized traffic, stale clients, migration runs and contention are hypotheses only. An invalid published URL still reads state before returning 404, so such traffic could matter; there is no evidence of an attack.

## Recommended smallest safe fixes and verification, before deployment

1. **First: remove automatic exhaustive media checks from ordinary production builds.** Separate basic preflight from an explicitly invoked deep storage audit. Keep one current metadata read and structural/identity/admin checks. Do not call `backup()` or loop over asset HEADs in normal builds; retain verified backup creation in the first-conversion mutation path. This preserves runtime behavior and removes 87 guaranteed HEADs per build at the observed asset count. It also avoids build-time backup writes. The tradeoff is that ordinary builds no longer detect an already-missing media object; keep that check as a deliberate maintenance task when quota permits. Do not run that deep audit now.
2. **Reduce duplicate requests without changing publication revocation.** Reuse already-loaded image elements during viewer/like/editor updates, update controls without remounting unchanged media, and avoid requesting a thumb again once that frame's full image is already displayed. Keep initial lazy loading and bounded instant preload. Verify actual browser requests against local synthetic fixtures. This reduces uncached state reads directly and requires no storage migration or cache-policy change.
3. **Combine read-only lookups within one HTTP request.** Resolve stored-owner/session/content checks from one freshly read, validated state snapshot rather than separate `localOwner()`, `sessionValid()` and media snapshots. Combine `checkUpload()` and `hasUpload()` decisions. Preserve fresh reads for every mutation/CAS retry and the intentional auth recheck after image processing. Never share a mutable snapshot across requests or reuse it after a write. This targets editor/upload overhead; it does not remove the required public per-request publication check.
4. **Defer broader caching changes.** A short-lived public-state cache with in-flight deduplication could save far more viewer operations, but cross-instance invalidation and immediate unpublish semantics must be specified first. Never simply remove `useCache:false` globally: state also contains sessions, throttling, revisions and owner data. Long browser cache lifetimes also delay enforcement for previously downloaded media. Private ETag/304 support is useful for bandwidth, but cannot promise a large Simple Operations reduction while every request still checks uncached state.

Before any deployment: implement the first change locally; add offline call-count assertions that routine preflight reads state once, makes zero HEADs/PUTs, and still fails closed for wrong identity, invalid schema, missing publication and missing administrator protection. Retain deep-audit and conversion-backup/CAS tests. Run local checks and the relevant Blob collection, multi-album, session, legacy media and publication-revocation tests with mocked storage. For subsequent request optimizations, assert reduced calls and verify unpublish, session deletion, replacement bindings and stale revisions still behave correctly.

Do not run `pnpm build` under production credentials before changing the preflight. Do not run `verify-public-album.mjs` snapshot/compare during this quota incident. After a reviewed deployment, inspect its build logs and usage counters passively; any live smoke test should be explicitly bounded to one album JSON request rather than a complete photo walk. No deployment was performed by this investigation.
