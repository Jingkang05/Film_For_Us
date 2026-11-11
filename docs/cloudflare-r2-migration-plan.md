# Cloudflare R2 migration: Phase A architecture and setup gate

Date: 11 November 2026. Branch: `codex/cloudflare-r2-migration`.

Historical Phase A plan. **Current implementation, recovery evidence and release gates are recorded in [r2-recovery-status.md](r2-recovery-status.md).** R2 is now enabled, isolated private buckets exist, adapters/tooling are implemented, and offline tests pass. Production cutover remains blocked by missing verified data and S3 configuration. Existing unrelated working-tree edits are preserved. Sections below retain the original plan and setup history; they are not a claim of production readiness.

## Why work stops at setup

The request explicitly says: “If I need to manually … Enable Cloudflare R2 … Create a bucket … Generate API credentials … Configure Vercel environment variables … Provide precise instructions and stop at the required setup step.”

Read-only configuration inspection found no R2 variables in the connected Vercel project. Its configured keys are `APP_ORIGIN` and `BLOB_READ_WRITE_TOKEN`; the local `.env.local` contains only a Vercel OIDC key. Values were not printed or decrypted.

Subsequent setup installed Cloudflare's official skills and connected its MCP server through OAuth. On resuming the migration, account discovery succeeded and identified exactly one accessible account. A read-only R2 bucket-list request returned HTTP 403, Cloudflare error code `10042`: **“Please enable R2 through the Cloudflare Dashboard.”** R2 activation is therefore a confirmed prerequisite, not merely a missing-credentials hypothesis. No bucket listing was obtained and no subscription, payment method, bucket, credential or production setting was changed. Stop here as explicitly required by the migration request; the user must review and complete R2 activation in the dashboard before resource setup and live validation can proceed.

## Existing architecture assessment

The HTTP entry point `api/[...route].mjs` opens `server/blob-album.mjs` and delegates to `server/index.mjs`. `server/collection.mjs` owns album operations. Local development has a SQLite adapter; no hosted relational database, PostgreSQL or Supabase integration exists in this repository.

The current private object layout is:

| Path | Contents |
| --- | --- |
| `roll-for-us/album.json` | Entire collection, owner credentials, sessions, throttling, upload inventory |
| `roll-for-us/media/<assetId>/{source,thumb,full}` | Legacy immutable original and optimized files |
| `roll-for-us/albums/<albumId>/media/<assetId>/{source,thumb,full}` | Additional albums' immutable files |
| `roll-for-us/backups/pre-phase-3-<sha256>.json` | Private full-state backups including authentication data |

The JSON envelope contains `album`, optional `albums`, `uploaded`, `owner`, `sessions`, `attempts`, optional `uploadAttempts`, `schemaVersion` and `phase3Backup`. Each album row contains stable `share_id`, revision, serialized draft/published content, publication revision, optional lifecycle flags/timestamps and upload inventory. Photo `assetId` can differ from stable photo `id` after replacement. Public responses strip private asset bindings. Preserve that distinction and all alias history.

All current SDK accesses are enumerated in `docs/blob-usage-investigation-2026-11-11.md`: uncached state/backup reads, default-cache image reads, source upload HEAD, source GET, failed-upload comparison GET and the production preflight's three HEADs per asset. No Blob SDK listing occurs in normal application requests. Presigned browser source upload uses PUT; Sharp processes the result on Vercel, generates an auto-oriented 1800px WebP at quality 88 and 480px WebP at quality 80. Limits are 20 MiB source, 50 million pixels, still JPEG/PNG/WebP; implemented browser HEIC conversion feeds that existing pipeline. Per-album active photo limit is 500.

Publication and media membership are checked on every request, including after unpublish. Admin routes use an HttpOnly session cookie and same-origin mutation checks. There is one administrator, rather than multi-user tenant ownership; preserve existing per-album membership validation and do not invent permissive ownership rules.

Current metadata updates use ETag compare-and-swap with six bounded conflict attempts. First conversion and production builds may create private backups. Routine production builds currently scan 87 asset HEADs for the 29 assets observed in prior build logs. Never run that scan as a migration prerequisite during this quota incident.

### What belongs where

Originals, optimized variants, immutable album snapshots and backups fit object storage. Sessions, throttling, unique aliases and mutable album/publication indexes are more naturally database records. At this single-administrator scale they can remain small private R2 control documents with atomic conditional writes, avoiding an additional service. SQLite on an ephemeral Vercel function filesystem is not a production alternative. Reevaluate a relational database when multi-owner transactions, contention or library size require it; no new database is proposed or created now.

## Proposed storage and metadata design

Keep Vercel, the current domain and API paths, Sharp, templates, schema, IDs, ordering and LocalStorage keys. Use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` on Node, lazily constructed server-side. No Cloudflare Worker or Pages deployment is required. Cloudflare documents this SDK configuration: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/.

Introduce a small object interface: `read`, `put` (create-only or expected ETag), `stat`, `delete`, paginated `list`, `signUpload`, optional internal `signRead`. Normalize missing objects, precondition failure, transient failure and returned content metadata. Bound transient retries separately from CAS attempts, with backoff; never blindly replay a write whose commit status is unknown. Keep the Blob adapter and add R2 behind secure provider configuration. Signing is capability generation, not authorization: application routes must authorize before calling an adapter. No public arbitrary-key delete/read API is introduced.

Keep original media keys on R2 for compatibility. Archive the exact legacy state bytes privately for recovery. Do not use that combined state blob as the R2 runtime media authorization source.

Proposed additional private metadata objects:

- A small mutable **collection control document** holds stable album IDs, unique slugs/aliases, revision/status and references to immutable draft and publication snapshots. It has no owner password hashes, session tokens or letter/photo content. One conditional replacement commits an album edit, publish, unpublish, delete or alias reservation atomically.
- **Immutable snapshots**, addressed by content digest, preserve current MemoryProject content and private asset bindings. Published and draft snapshots are distinct references. Cache parsed snapshots and immutable bytes only under their exact immutable identity, with bounded memory and request coalescing.
- A separate **authentication control document** holds the existing owner hash/salt, hashed sessions and login/upload rate limits. It is never reachable through media routes and is not cached across requests. Atomic auth mutations do not require an album transaction.

Write new immutable snapshots first with create-only semantics. Then CAS the collection control document using its observed ETag and expected album revision. A failed CAS leaves only an unreferenced immutable object, never a partial publication. Retry from current control state; reject stale album revisions. Updating status and the active publication pointer in one object prevents an independently updated ACL from exposing stale media. All public aliases resolve through this same authority. Read-only editor requests share one control read and one authentication read; do not reuse a snapshot after a write or skip the post-processing auth recheck.

Cloudflare's S3 API now documents atomic `PutObject` conditions (`If-Match`, `If-None-Match`): https://developers.cloudflare.com/r2/api/s3/conditional-operations/ and https://developers.cloudflare.com/r2/reference/consistency/. Verify these with the selected SDK and non-production bucket before relying on them. Never substitute unconditional writes or treat a cross-provider ETag as a content checksum.

This is a targeted repository/storage refactor, not a frontend or whole-backend rewrite. The legacy logical model remains available through a compatibility facade for existing routes and tests. Conversion of its internal persistence envelope is deliberate and requires offline round-trip proof before production migration.

## Private delivery, caching and revocation

Retain `/api/a/<share>/media/<photoId>/<variant>` and private preview routes. Each image request freshly reads the small authoritative collection control document, checks current publication, resolves the exact published immutable snapshot and validates the photo binding before reading any bytes. Private previews additionally validate the fresh session and draft membership. Never fall back to an older publication when R2 control/auth reads fail; fail closed.

Keep browser delivery on `filmforus.space` and implement `Cache-Control: private, no-cache` with ETags/304 only after fresh authorization. Validators include publication generation, asset binding and variant, so replacement cannot reuse an old response accidentally. A 304 can avoid an R2 image GET by comparing a trusted snapshot digest; it must never bypass authorization. Do not apply public `s-maxage`, a stale authorization cache, or a long browser freshness lifetime. Immutable image bytes and snapshots may be cached inside the server with strict memory bounds; access checks still precede every response. No cache hit may serve a removed photo, unpublished album or revoked preview session.

Reuse loaded image DOM elements and avoid remounting unchanged images in viewer/editor rendering. Keep lazy loading, mobile thumbnails, instant preload limits, original animations and resolution/quality. Browser memory reuse is limited to bytes already delivered; no design can recall previously downloaded images. Requests authorized before a concurrent unpublish may finish; subsequent authorization checks after the committed unpublish must deny access.

Do not issue signed GET URLs in the initial delivery implementation. They disclose an object URL and remain bearer access until expiration, so immediate revocation cannot be guaranteed. Keep any adapter read-signing method internal and unexposed. For fallback, consult Blob only for an explicitly inventoried immutable legacy media key missing in R2, after authorization from the active R2 control document. Never use fallback for auth/control, never mask 403/5xx as a missing object, and cap/log fallback use without logging sensitive paths or URLs. Avoid permanent silent dependency on the remaining Blob quota.

### Request targets, not measured after-results

Current public media: one full-library origin GET plus one image GET; current editor media: two or three full-library origin GETs plus one image GET. Proposed warm public media: one small control GET; zero image GETs for a valid 304 or server byte-cache hit, otherwise one. A cold immutable snapshot adds a GET; do not pretend cold requests always improve operation count. Proposed read-only editor media: at most one auth and one control GET, with immutable-content cache misses counted separately. No root/auth cache TTL is introduced. Strict revocation requires a fresh authority check; zero storage operations for arbitrary new requests is not a compatible promise.

Normal builds should make no storage mutations or exhaustive per-photo HEAD calls. Deep integrity scans become explicit maintenance tasks. Remove the existing automatic scan before any production rollout. Verify operation budgets offline before migration.

## Upload design and protection

Use owner-authorized, short-lived (target 120 seconds) presigned PUT of an unguessable create-only staging/source key, scoped to an exact object. Do not expose permanent credentials, arbitrary-key selection or signed delete access. Sign the required headers; CORS must match the actual signed header set. Where supported, bind a client-calculated SHA-256 to the signed upload to prevent content changes on replay. Confirm create-only header enforcement with the real R2 API.

Presigned PUT is not by itself a reliable maximum-size policy. After upload, the backend performs one metadata validation and bounded source read; rejects above 20 MiB before allocating/processing the whole file; then applies the existing signature, dimensions, animation and format checks. Retain pixel limits and server authorization/revision checks. Bound processing concurrency, upload authorizations and attempts per session/IP; add cumulative upload byte limits and a per-album byte cap based on actual inventory. Log normalized storage errors and aggregate counters without credentials, personal content or signed URLs. A leaked PUT URL can still create cost until expiry; the free tier is not a hard cap.

Do not proxy the original 20 MiB browser payload through Vercel: its documented function payload ceiling is 4.5 MB, https://vercel.com/docs/functions/limitations. Preserve direct upload followed by a small finalize request, server-side bounded R2 download, Sharp and optimized variant PUTs. Stream downloads/hashes where practical; Sharp memory and execution time need non-production testing. HEIC conversion remains local as implemented.

Interrupted uploads remain unreferenced and must be resumable/idempotent. Do not delete a possibly referenced file on processing failure or a concurrent revision conflict. Cleanup will require verified reference checks, an age grace period and its own explicitly authorized process. No cleanup runs as part of this migration.

## Manual configuration: required next step

1. Sign into your intended Cloudflare account and open **R2 Object Storage**. If it requests subscription activation or a payment method, review that screen yourself and stop there until you approve those terms. This agent has not activated R2. R2 subscription/credential prerequisites: https://developers.cloudflare.com/r2/get-started/ and https://developers.cloudflare.com/r2/api/tokens/.
2. If already enabled, create private **Standard** buckets (suggested names: `film-for-us-dev`, `film-for-us-preview`, `film-for-us-prod`; use existing appropriately isolated buckets if available). Keep public `r2.dev` access disabled and do not connect a public custom domain. Consider an Asia-Pacific location hint appropriate for the Singapore Vercel backend; hints are best effort, not a mainland guarantee. Bucket setup: https://developers.cloudflare.com/r2/buckets/create-buckets/; location: https://developers.cloudflare.com/r2/reference/data-location/.
3. Under R2 **Account Details → API Tokens → Manage**, create bucket-scoped **Object Read & Write** credentials, separately for each environment. Do not grant account/bucket administration. That permission can also delete objects; the runtime must not expose that power through public routes. Keep migration credentials separate and short-lived where available. Save the Access Key ID and Secret Access Key securely; the secret is shown only once. No credentials or account identifiers belong in Git, screenshots or this chat.
4. Configure bucket CORS for browser PUTs. Production should allow only `https://filmforus.space`; add exact preview/local origins only to their own buckets. Allow method `PUT`; allow `Content-Type`, `If-None-Match` and the checksum headers actually signed by the adapter; expose `ETag`. Use a short preflight max age such as 300 seconds. Final header names must be verified during Phase B; CORS does not provide authorization or require public bucket access. See https://developers.cloudflare.com/r2/buckets/cors/.
5. Open the existing Vercel project's **Settings → Environment Variables** and add the following server-only names with separate Development, Preview and Production values. Store the access-key secret as a secret/sensitive variable; do not use `VITE_`, `NEXT_PUBLIC_` or any browser-export prefix. Keep local values in an ignored local env file. Do not change the production provider yet.

| Proposed variable | Value/purpose |
| --- | --- |
| `STORAGE_PROVIDER` | Keep `vercel-blob` until verified cutover; later `r2` |
| `R2_ENDPOINT` | HTTPS S3 API endpoint copied from R2 dashboard; do not commit its account identifier |
| `R2_BUCKET` | The bucket for that environment |
| `R2_ACCESS_KEY_ID` | Bucket-scoped S3 credential ID |
| `R2_SECRET_ACCESS_KEY` | Matching secret |
| `R2_REGION` | `auto` (SDK signing region, distinct from location hint) |
| `APP_ORIGIN` | Exact origin for that deployment's CSRF checks |

These are proposed configuration names; current application code does not consume R2 variables yet. Preserve the existing Blob credential for rollback and migration, but do not let ordinary preview deployments mutate production storage. Existing Blob credentials currently span all three Vercel environments; isolate this in the future provider-selection rollout without revoking the production credential prematurely. Do not redeploy merely to add these variables: existing production builds still run the expensive preflight.

Setup completion means confirming the selected environment buckets remain private and credentials are stored securely. The first live validation should use only synthetic fixtures in development/preview. Production remains on Blob until the later cutover prerequisites pass.

## Migration sequence and quota budget

No production inventory is claimed. Prior build logs prove 29 referenced legacy assets, not the entire store inventory; other albums, replacements, backups and orphans may exist. Sizes/MIME types are not yet measured.

1. Build the adapters and deterministic offline conversion/migration tools. Inventory schema: source key/reference, size, MIME, album associations (possibly multiple), stable photo ID, asset ID, variant, source ETag, source SHA-256, destination key/ETag/SHA-256, stage, attempt/error and verification time. Keep manifests and raw backups private, outside Git, mode 0600. Do not copy account credentials into a manifest.
2. Get a refreshed usage counter without browsing Blob objects. Configure a hard source-request budget and reserve (initial proposal: reserve at least 100 of the reported 347, with every retry charged to the budget). Do not assume that old screenshot is still current.
3. Paginate Blob listing once, persisting each page/cursor and using listing metadata instead of per-object HEADs. Listing uses Advanced Operations, whose remaining quota also needs checking. Read current state once to map legacy/new prefixes, publication/draft bindings and historical references. A live inventory is not needed to complete Phase A, and none was performed.
4. Start a controlled write-freeze enforced in every old/new production mutation handler before any auth/throttle mutations. Include login/logout, upload authorization/finalization and stateful counters, not just Save/Publish. Drain active processing and wait out preexisting signed uploads (currently up to five minutes); reconcile late source objects. Old deployments capable of writing must also be fenced or made inaccessible. Vercel environment changes alone do not update already-running deployments. Keep public reads available if practical; their continuing Blob cost must remain in the budget. Do not copy a moving auth/session document and call it consistent.
5. Capture exact final state bytes and ETag; hash and verify a durable private backup and protected local copy. Obtain a frozen final inventory. Copy each object once at concurrency one, computing SHA-256 from source bytes while streaming to R2. Preserve keys and sources. Verify destination size, MIME and complete downloaded SHA-256 against the recorded source checksum. A successful PUT, ETag or matching size alone is insufficient. A retry can use a securely staged verified local source rather than redownloading Blob.
6. Resume by matching source identity and verified destination digest, not merely object existence. Detect duplicate/conflicting keys, partial writes and changed source metadata; stop rather than overwrite mismatched data. Keep immutable backup generations; do not assume Blob or R2 has version history enabled. Copy orphan/backup objects or explicitly inventory them as retained-source exclusions; distinguish a complete-store migration from a referenced-media-only cutover.
7. Convert the frozen legacy envelope into auth/control/immutable snapshots offline, compare every album ID, photo ID, binding, content, ordering, status, revision and alias, then write R2 with create-only/CAS guards. Keep the exact old envelope for reverse conversion.
8. Validate every invariant and access rule against synthetic/non-production tests, then a tightly bounded production check only after all conditions pass. Switch provider during the freeze; keep existing public paths and fall back only for the verified legacy-media allowlist. Unfreeze only after readback and security checks. New uploads must use R2. Never delete source objects.

Quota estimate: the known 29 assets imply 87 source objects, or approximately 88 source GETs including one state document. This is a lower bound, not the total inventory. Destination verification consumes R2 reads, not Blob rereads. Additional albums/backups, inventory metadata, retries and concurrent viewers can exceed the remaining allowance; do not start copying until the actual count fits the hard budget. Abort on budget exhaustion with a resumable journal, not an unbounded retry.

## Rollback boundaries

Before unfreezing writes, revert provider configuration/code to the untouched frozen Blob state and remove the freeze only after confirming the original state remains current. After R2 has accepted new writes, simply flipping back to the old Blob document would lose albums, photos, sessions and edits. Instead keep compatible R2-capable code on application rollback, or freeze and perform a separately verified reverse migration including new media and reconstructed legacy envelope. That reverse copy itself needs available Blob quota. Do not promise instant data rollback after accepting R2 writes. An R2 authority outage cannot safely be masked by old Blob publication/session state.

## China, Safari and operating costs

Existing-domain backend delivery avoids requiring viewers to reach the R2 service domain for reads. The Vercel-to-R2 hop is server-side. Direct browser source PUT still depends on reachability of the R2 S3 endpoint; test it on real mainland networks before release. Cloudflare's ordinary network is not equivalent to its separate China Network: https://developers.cloudflare.com/china-network/ and https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/geographic-traffic-routing/. A public R2 custom domain is not an acceptable privacy workaround. China accessibility, DNS, TLS and latency are unverified; no mainland or real iPhone test was performed. Test at least Malaysia and mainland mobile/Wi-Fi, iPhone Safari HEIC selection/upload, image loading, viewer controls, cookie sessions and expired signed upload behavior.

Standard published pricing: 10 GB-month storage, 1M Class A and 10M Class B operations included monthly; overage $0.015/GB-month, $4.50/million A, $0.36/million B; Internet egress is free. Cloudflare applies billing-unit rounding. See https://developers.cloudflare.com/r2/pricing/. These are allowances, not a spending cap, and Vercel function/transfer charges remain separate.

Actual total storage, monthly visits and upload traffic are unknown. Illustrative only: 1,000 visits × 29 photos × two variants, with no browser reuse, entails about 58,000 control reads and up to 58,000 image reads, plus initial/cold snapshot reads; R2 operation allowances are ample at that scale but amplification still needs fixing. Without bytes-per-object inventory, do not claim measured monthly dollars. Report stored bytes and A/B counters by environment, set available usage/billing notifications, and implement operational thresholds on upload bytes/attempts and migration requests. Alerts do not impose a guaranteed hard spend cap.

## Verification and deliverable status

The existing offline operation audit was rerun successfully: eight assertions, zero production requests. It confirms the current baseline, not R2 readiness. No application code changed in Phase A; no build with production credentials ran.

Phase B/C acceptance must cover adapter upload/read/stat/delete/missing/failure behavior, bounded retries, atomic conflict handling, source mapping, duplicate objects, interrupted/resumed copy, byte-level corruption, rollback round trips, private previews, revoked sessions, publish/unpublish, replacement/deletion, unauthorized mutations and signed PUT expiration/size/checksum enforcement. Include operation-count assertions and prove ETag 304 cannot bypass authorization. Run normal build with storage checks disabled or isolated non-production settings, TypeScript checks and the full automated suite. Then local browser regression for editor/create/edit/reorder, envelope/viewer/development/hanging, likes/collection and original routes; real iPhone and mainland checks remain separate release gates.

| Deliverable | Current state |
| --- | --- |
| Architecture/configuration/security/request analysis | Documented here; proposed implementation |
| Modified files | This Phase A plan only; previous investigation and synthetic audit remain present |
| Inventory, backup verification, migrated-object integrity | Not performed; live setup/quota/freeze gates outstanding |
| R2/Blob adapters and provider selection | Planned, not implemented |
| R2 tests/build/browser results | Pending implementation and non-production configuration |
| Production deployment/cutover | Not performed; production remains on Blob |
| Remaining Blob dependencies | Existing runtime, upload signing, build scan, migration/verification utilities and source objects |
| Rollback | Defined above; untouched sources alone are insufficient after new R2 writes |
| Phase 4 | Continue unrelated work only in isolated fixtures; do not merge it with migration or depend on an unverified cutover |

Next action is the user's Cloudflare setup step above. Do not treat this plan as proof that any bucket, backup, migration or security verification already exists.
