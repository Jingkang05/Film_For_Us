# R2 migration and recovery status — 11 November 2026

## Production is not yet recovered

Implementation and offline verification are complete for the initial R2 backend. Production cutover is blocked by missing original data and unverified live S3 access. No partial album was published, no production provider was switched, and no source Blob object was changed or deleted. Do not interpret passing tests as verified production recovery.

## Infrastructure and credentials

The Cloudflare connection is authenticated. R2 activation was confirmed after the user enabled it. Three separate APAC Standard buckets were created: `film-for-us-dev`, `film-for-us-preview`, `film-for-us-prod`. For each, the managed public domain is disabled and no custom public domain is connected.

The MCP connection cannot create account API tokens: Cloudflare returned 403 and identified missing `Account API Tokens Write` scope. Rather than broadening account-wide token-management access, the user was given instructions to create separate bucket-scoped Object Read & Write S3 credentials and store them in the corresponding Vercel environments. The user added the Production access-key ID and secret in Vercel; the secret is marked sensitive and cannot be read back. The remaining Production endpoint, bucket, region and environment-marker settings were configured, with `STORAGE_PROVIDER=vercel-blob` deliberately retained. Development and Preview credentials are not yet confirmed. No credentials appear in code or reports.

Production CORS was **configured after the user explicitly approved the exact rule**: origin `https://filmforus.space`, method `PUT`, allowed headers `content-type` and `if-none-match`, exposed response header `ETag`, preflight max age 300 seconds. Readback verified the rule and confirmed public managed-domain access remains disabled. Automatic review had rejected the initial attempt; no workaround was used before approval. CORS only permits browser requests; the bucket stays private and signed requests remain required. Development and Preview must use their own exact origins and credentials.

The user also explicitly approved a 15-minute temporary credential restricted to `roll-for-us/media/` and `_migration-validation/` for synthetic testing and staging 33 recovered objects. The approved request reached Cloudflare but returned API **403 Access Denied**. No temporary credential was issued; no user files were copied to R2 and no synthetic object was written or deleted. The temporary credential's authority would not have included collection/auth metadata. Live SDK validation/copy remains blocked until a saved S3 credential is available in a private local environment file or an authorized migration runner. The permanent Vercel secret was not bypassed or exposed.

## Vercel Blob availability

Vercel runtime logs for the current production deployment show repeated `BlobError: Failed to fetch blob: 403 Forbidden` from `read()`/`snapshot()` for public album and editor requests. This confirms access failure, not deletion. It is consistent with the user's exhausted quota report, but the logs alone do not distinguish quota enforcement from every possible authorization cause.

Because existing production diagnostics already demonstrate blocked reads, this recovery run made **zero additional production Blob GET/HEAD/LIST requests**. No direct probe was repeated and no exhaustive scan was run. Prior historical usage attribution remains unproven. Billing was not changed to obtain access.

## Recovery sources and provenance

| Source | Verified finding | Limitation |
| --- | --- | --- |
| Local `.data/album.sqlite` with existing WAL | Original album ID, historical revision 14, 11 photos and their original/thumb/full bytes; local administrator record exists | Older than current production; not a full current state backup |
| Saved production response `/private/tmp/filmforus-phase3-public-baseline.json` | 29-photo public album content; canonical SHA-256 exactly matches the Phase 3 release manifest | Historical public snapshot, not current private state; omits alias history, drafts, sessions and other albums |
| Additional Phase 1/2 saved responses | Same canonical public content as the verified 29-photo snapshot | Corroborates history, not currentness |
| `.data/phase3-regression-manifest.json` | 58 recorded optimized-image checksums and canonical public-content hash | A checksum manifest is not a media backup |
| GitHub default branch and relevant local Git refs/history | Album ID appears in verification code, documents and synthetic tests | No verified production album content or original media recovered from GitHub |
| Temporary preview SQLite databases | Empty synthetic/demo albums | Not recovery sources for the original album |

Verified historical public content digest: `410dbe4feb626a962db9a6309b7a22e0b33d38a31b12b19c1416795a631db3bd`.

The local database has **11 of the 29 photo IDs**. For every one of those 11 photos, both thumb and full bytes match the production release hashes exactly: **22 optimized variants verified**. Their associated 11 original/source files were recovered with those same IDs; no original-source checksum exists in the public release manifest, so original-byte agreement with production is not claimed. Generated variants were not regenerated unnecessarily.

**18 photos are missing locally**. No substitutes, new photo IDs, guessed captions or guessed ordering were introduced. Current draft data, later edits, the latest private revision, full alias history and other albums remain unavailable. The Phase 3 release report documents at least one additional unpublished sample album; it must not be silently discarded during a future restore.

Recovery output is private under `.data/r2-recovery/` (ignored by Git and Vercel packaging):

- `published-content.json`: the checksum-verified historical public response, including all 29 stable photo IDs and ordering.
- `inventory.json`: 33 recovered local objects (11 source, 11 thumb, 11 full), with bytes, MIME, SHA-256, local filenames, original IDs and original destination keys.
- `recovery-report.json`: complete missing-photo ID list, source provenance and explicit `readyForProduction:false`.
- Individual recovered objects named by stable photo UUID and variant.

Recovery files are written with private permissions. They contain personal album data and must not be committed, served by preview routes, or uploaded as public artifacts. The original SQLite database and existing release records were preserved.

The recovered 33 objects total **17,702,662 bytes**: originals 16,145,576; thumbnails 161,178; full variants 1,395,908. These are measured local recovery sizes, not the complete production store size.

## Implemented files and behavior

| Files | Purpose |
| --- | --- |
| `server/object-storage.mjs` | Normalized conflicts/failures, SHA-256, bounded streaming reads, bounded immutable-byte cache and in-flight coalescing |
| `server/r2-storage.mjs` | Official AWS SDK v3 adapter for private S3-compatible read/write/stat/delete/list and short-lived create-only PUT signing |
| `server/vercel-storage.mjs` | Blob recovery adapter behind the same object interface; no application retry of a blocked source |
| `server/r2-album.mjs` | Small fresh collection control document, immutable per-album snapshots, separate auth document, CAS edits, authoritative media checks, conditional responses and allowlisted immutable fallback capability |
| `server/storage.mjs`, `api/[...route].mjs` | Explicit server provider selection; production default remains `vercel-blob`; previews reject shared Blob access and require isolated R2; missing R2 initialization/configuration fails closed |
| `server/index.mjs` | Combined R2 owner/session check, private image ETag/304 responses, request-scoped root reuse and write-freeze before all POST-side auth/counter mutations; SQLite/Blob byte responses remain compatible |
| `server/collection.mjs` | Optional cumulative per-album byte limit, checked atomically during upload metadata commit |
| `src/manage.ts` | Sends exact server-provided signed PUT headers; create-only retry can finalize an already-uploaded immutable source |
| `scripts/verify-production-storage.mjs`, `server/blob-album.mjs` | Network-free routine builds; explicit metadata-only preflight; asset/backup scanning only in an explicitly requested deep audit |
| `scripts/storage-migration.mjs` | Required media inventory, private atomic journal, bounded serial copy, checksum/type/size readback, interruption/resume, guarded initialization and metadata round-trip verification |
| `scripts/recover-local-album.mjs` | Read-only SQLite recovery validated against saved release content and per-variant hashes; explicitly reports missing data |
| `scripts/preview-r2.mjs` | Loopback-only in-memory repository preview with public sample images, never production data or credentials |
| `scripts/verify-r2-connection.mjs` | Prepared live synthetic-object SDK check for upload/read/stat/create-only/CAS/stale-CAS/delete/missing; not executed without credentials |
| `vercel.json`, `.vercelignore`, `.gitignore` | Permit R2 signed upload connections, preserve private recovery/dependency exclusions, omit preview/test/doc artifacts from Vercel packaging |
| `test/r2-*.test.mjs`, `test/storage-migration.test.mjs` and fixture | Storage, privacy, CAS, migration-resume/integrity and compatibility regressions |

The persistence conversion retains the current logical album/MemoryProject model. A control-document CAS atomically publishes status, aliases and the immutable row reference. Immutable snapshots are written before switching the pointer. Auth hashes, sessions and throttle state live in a separate private mutable object. They are never put into a public content response or cached between requests. Existing legacy and additional-album media key conventions remain unchanged.

Source downloads are bounded to the existing 20 MiB upload allowance; Sharp validation, orientation, 1800px quality-88 full and 480px quality-80 thumbnails remain unchanged. HEIC conversion stays in the existing browser pipeline. An optional conservative cumulative 2 GiB album cap counts accepted upload bytes without reclaiming on deletion/replacement. A verified complete migration must seed existing byte usage before relying on that cap for historical data. Failed/unreferenced uploads are retained safely; no automatic garbage collection was introduced.

## Security and request analysis

Every public media request reads current collection authority before consulting an immutable snapshot or image cache. Every private preview additionally checks the current administrator session. Cached bytes and 304 handling cannot bypass unpublish, removal, replacement or session revocation. No signed GET URLs or public bucket access were introduced. In-flight requests authorized before a concurrent unpublish may finish; later authorization checks deny access. Previously downloaded copies cannot be recalled.

SDK exceptions are normalized without retaining their original cause, preventing normal error logging from dumping signed URLs or credential-bearing headers. Configuration is server-only, rejects insecure/unrelated R2 endpoints, and fails if required values are missing. Provider fallback is off by default; an optional verified immutable-media allowlist cannot fall back for authority or authentication failures.

| Request | Existing Blob behavior | R2 implementation |
| --- | --- | --- |
| Warm public image | Full-library origin GET plus CDN-eligible image GET | One small fresh control GET; no image GET on immutable byte-cache hit or valid 304 |
| Cold public image | Full-library GET plus image read | Control GET + immutable per-album snapshot GET + image GET; cold operation count can be higher |
| Read-only editor image | Two or three full-library GETs plus image read | One fresh auth GET and one fresh control GET; immutable content/bytes reused when warm |
| Same-request repeated album lookups | Repeated uncached state reads | One request-scoped control read; mutators use fresh CAS state and invalidate it afterward |
| Routine production build | Three asset HEADs per original photo plus backup/state reads | Zero storage requests and zero writes |

No claim is made that strict authorization can be preserved with zero authority reads. The migration reduces redundant full-library/auth reads and R2 byte reads without caching mutable authorization. It does not rewrite Viewer interactions or add polling. Blob-only mode retains its existing runtime behavior until cutover; the build fix is backward compatible.

## Validation results

- Production-mode build passed with `VERCEL_ENV=production` and default storage preflight: output explicitly states build storage reads were skipped.
- TypeScript and all syntax checks passed.
- Full `node --test` suite: **64 passed, 0 failed**, including exact-byte backup integrity. Loopback-dependent tests required execution outside the restricted network sandbox. A SQLite Uint8Array compatibility issue found by the full suite was fixed and the complete suite rerun successfully.
- Offline Blob audit: **8 assertions passed, zero production requests**. Metadata preflight now asserts one GET, zero HEADs and zero backup writes; explicit deep audit is exercised only against synthetic memory objects.
- New tests cover S3 command mapping, create-only/CAS headers, missing objects, 403/429/500 normalization, short signed expiry/header binding, configuration rejection, stale edits, stable-ID replacement, unpublish after byte-cache/304 hits, preview session revocation, unauthorized upload/delete, freeze before login writes, missing initialization, byte limits, allowlisted fallback, duplicate inventory keys, budget stop/resume and corrupt source/destination handling.
- Local browser verified envelope opening, entry to the film table, photo loading through R2-shaped API responses, liking, development and hanging into the final collection with public repository sample images. Existing typography and animation edits in the user's working tree were not incorporated into migration source changes.
- Live S3 upload/download/CORS/expiry validation remains pending credentials; mocks and local repository verification do not replace it. No real mainland China or iPhone Safari test was performed.

## Cutover and rollback gates

Do not initialize the production control document or switch `STORAGE_PROVIDER=r2` until all 29 original photos and all other albums are reconciled, current metadata/auth are verified, production credentials/CORS are configured, a frozen consistent backup is verified, and destination bytes and metadata pass readback checks. The initializer refuses an existing control document; copying never overwrites mismatched destinations or deletes sources.

Use a controlled freeze across every writer, including login/session/throttle paths and old active deployments. Drain already-issued signed uploads. Preserve exact legacy state bytes, hashes and original source references. A complete verified state can generate a migration inventory with `storage-migration.mjs plan`; locally recovered objects can be copied with `copy-local` after credential setup. Copy tools operate serially, persist progress, read back destination checksums and stop on the first source or integrity failure. Do not run a Blob copy while it is returning 403.

Before R2 accepts writes, rollback can restore the frozen, verified Blob configuration. After R2 accepts writes, retain R2-capable code on application rollback or perform a separately frozen and verified reverse migration. Switching blindly to an old Blob document loses new changes. Untouched source objects remain a recovery source but are not sufficient to guarantee post-write rollback.

## Required next inputs

1. Production Vercel configuration names are now present, but live S3 verification is still required. For local migration/testing, securely save a bucket-scoped credential in an ignored file such as `.env.r2.local` with the five R2 connection variables; do not paste keys into chat. Development and Preview need their own credentials and `R2_ENVIRONMENT` matching their Vercel scope. Production's marker is configured. Preserve `STORAGE_PROVIDER=vercel-blob` until cutover gates pass.
2. Restore authorized Blob access without unapproved billing changes, or provide a recent full private state backup plus original files for the 18 missing photo IDs. Exact IDs are in the private recovery report. If providing originals, retain original filenames/metadata and a verified mapping to the existing UUIDs; filename order alone is not sufficient. Captions/order for the historical 29-photo publication are already available, but latest-state/other-album reconciliation remains necessary.

No production deployment or data cutover is claimed. The unchanged original public URL is supported by the code; its production content cannot be truthfully verified until recovery prerequisites are met. Do not publish placeholders to make the URL appear healthy.

## Cost and future storage

Actual complete library size and future traffic are unknown. No measured monthly R2 cost can be asserted. The private inventory contains measured sizes for the 33 recovered objects. Monitor storage and Class A/B usage per environment and configure available budget notifications; allowances are not a hard spending cap. Vercel function and response-transfer costs remain.

No PostgreSQL/Supabase service was added. A future relational migration should move ownership, publication/alias constraints, sessions, quotas and audit records into transactions once multiple owners or sustained contention justify it; retain the object interface and immutable media/snapshot identities. Phase 4 work remains out of scope.
