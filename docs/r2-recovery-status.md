# R2 recovery and release evidence — 11 November 2026

## Verified recovery

The user explicitly authorized an emergency partial recovery and automatic production release after critical checks pass. This replaces the earlier requirement to recover every original before release.

The private production R2 bucket now contains **33 verified media objects for 11 photos**: 11 source files, 11 thumbnails and 11 full variants, totaling 17,702,662 bytes. The remaining **18 photos** are omitted from both initial visible sequences and retained in private recovery metadata with their stable IDs, captions, dates and historical positions. No placeholders, guessed mappings or new photo IDs were introduced.

The original album ID is `OhqQkmPtTAlxEkHH`; its URL remains https://filmforus.space/a/OhqQkmPtTAlxEkHH. The three recovered rolls contain 5, 5 and 1 photos.

Metadata comes from the checksum-verified historical 29-photo publication. Its canonical SHA-256 is `410dbe4feb626a962db9a6309b7a22e0b33d38a31b12b19c1416795a631db3bd`. It may omit newer edits, private drafts, other albums and interaction history. The local SQLite/WAL provided the 11 associated sources and all 22 optimized variants; both variants for every recovered photo match historical production release hashes exactly. No historical production checksum exists for the original source bytes, so original-byte agreement with production is not claimed.

The historical local administrator salt/password hash is retained, sessions are cleared, and recovery starts a new revision generation at zero. No default administrator password was introduced.

## Live R2 verification

The initial saved key could not access the production bucket: both the write job and a single read diagnostic failed with 403; the latter reported `AccessDenied`. Cloudflare showed the existing token scoped to the development bucket. After the user created and saved the matching production credentials, the live recovery succeeded. No secret was printed or read back.

Private build-only recovery deployment: `dpl_CPC38q9rqDLCjW9MMU57U1Zn3Vbi`, status **READY**. It ran with Production variables and `--skip-domain`; it must never be promoted as the application.

Verified results:

- Synthetic create/read/stat/create-only conflict/CAS/stale-CAS/delete/missing checks passed. Only the newly created disposable synthetic object was deleted.
- All 33 allowlisted objects passed size, MIME and SHA-256 readback. Copying was serial and create-only; mismatched existing objects abort rather than being overwritten.
- An exact-byte private initial-state backup was written and read back before initialization.
- Reconstructed logical state matched SHA-256 `f3f4e1502496a576a9203b3e9e1f01331dcd3b01d929a70265304e5caeddd2e0`.
- Original album returned the exact 11 expected photo IDs. All 18 pending IDs were denied media access. Recovery/admin metadata was absent from public content.
- No migration HTTP endpoint was created. Inputs stayed outside the public output directory.

The bucket remains private: managed r2.dev access disabled, no public custom domains. CORS allows only the previously approved `https://filmforus.space` origin, PUT, `content-type` and `if-none-match`, exposed ETag and 300-second preflight caching. Signed authorization remains required.

## Application release gate

Staged R2 application deployment: `dpl_4guo5DcXmgYk6gYR4c8tQuxb52A2`, status **READY**, source commit `47f83e1b48784e716bc27a2a7d1616f5d744887e`. It uses Production variables without assigning the public domain. This verified R2 application is the initial application rollback target.

Ten bounded staged checks passed: original album HTML 200, exact 11-photo metadata with no missing-photo or sensitive fields, anonymous editor 401, draft media 401, upload-target 401, delete 401, missing-photo media 404, absent migration API 404, thumbnail and full-image checksum samples 200, and conditional thumbnail 304. Media responses use `private, no-cache`; authority is rechecked before cached bytes or 304. The staged runtime error/fatal log scan was empty.

Other validation:

- Full automated suite: 67 passed, 0 failed. Added safe provider-code checks also passed the focused four-test storage suite.
- TypeScript/syntax checks and Production-mode build passed. Build output confirms storage requests are skipped.
- Offline Blob audit: 8 assertions passed, zero production requests.
- Local actual-data browser checks passed envelope, film navigation, Chinese/English controls, liking, development, hanging and final collection.
- A 390px mobile viewport displayed 11 photos across three rolls, zero broken images and no horizontal overflow. This is browser responsive testing, not a physical iPhone or mainland-China network test.

These gates authorize the requested merge of PR #2 and GitHub → Vercel Production release. Final public deployment ID, commit, status and post-release checks are recorded in the private `.data/r2-recovery/production-release-result.json` and the operator's release message after deployment; this gate report does not by itself claim the production alias has moved.

## Storage behavior and investigation evidence

Existing production runtime logs showed Blob GET 403 failures. They confirm access failure, not deletion; quota enforcement is consistent with the user's report, but historical daily-spike attribution remains unproven.

Confirmed amplification in the earlier implementation:

| Trigger | Earlier behavior | R2 release behavior |
| --- | --- | --- |
| Routine build with 29 photos | 87 asset HEAD checks plus metadata/backup work | Zero storage operations by default |
| Warm public image | Full-library read plus media access | Small fresh control read; immutable snapshots/bytes reused |
| Read-only editor image | Repeated full-library/auth reads | One fresh auth read and one control read with request reuse |
| Unchanged cached image | Repeated media delivery | ETag 304 after current authority validation |

Cold R2 requests can require control, immutable snapshot and image reads. Mutable publication/session authority is deliberately never shared across requests. No claim of zero per-image authority reads is made. No polling or viewer redesign was added.

This recovery made **zero additional production Blob GET/HEAD/LIST requests**, no Blob deletes or writes, and no billing or DNS changes. Source Blob data, local SQLite/WAL and historical records remain preserved.

## Configuration and rollback

Production uses `STORAGE_PROVIDER=r2`, `R2_BUCKET=film-for-us-prod`, `R2_REGION=auto`, `R2_ENVIRONMENT=production`, the private HTTPS S3 endpoint and user-managed sensitive credentials. Secrets are server-only. Preview rejects production bucket reuse and shared Blob access; its independent environment setup is outside this emergency cutover.

Previous production code reference: `5120c185…`, deployment `dpl_A97VCsEU3D19Mm4ZfxoAsk8uAvGc`. It relies on the exhausted Blob store and is not the post-cutover recovery target. Preserve the proven R2 staged application and immutable snapshots instead. Never replay the initial-state backup over new writes, delete recovered objects, or switch blindly back to stale Blob state.

## Remaining recovery

Private recovery artifacts live under ignored `.data/r2-recovery/`: verified inventory, historical content, partial state, live/staged reports and **missing-photos.md**, a checklist of the 18 original photo IDs. These are excluded from GitHub and public deployment output.

Supply missing original files with filenames intact. `scripts/rebuild-recovery-variants.mjs` uses the unchanged Sharp pipeline to match both variant hashes to a unique historical ID; it refuses ambiguous or unmatched mappings. Copy the verified inventory with `storage-migration.mjs copy-local`, then use `restore-pending` in an authorized server environment. The latter rechecks stored hashes, restores existing IDs/metadata into the draft with CAS protection, and leaves publication unchanged. Review and Publish in the Album Editor when ready. No public URL change is needed.

Recent edits, optional drafts and other albums remain unavailable unless separately recovered from a current backup or the preserved Blob source. No complete historical recovery is claimed.
