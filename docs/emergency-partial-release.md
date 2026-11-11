# Emergency partial recovery release

This supersedes the earlier requirement to recover all original media before release. The user accepts a historical partial publication. Production execution still requires the explicit approval requested by automatic review; preparation and offline testing alone do not mean the site is restored.

## Prepared data

- Original album ID and public URL are unchanged.
- The checksum-verified historical 29-photo publication is the metadata source. It may omit later edits and other albums.
- Public and editable initial sequences contain only the 11 verified photos: 5, 5 and 1 across the existing three rolls. No placeholders or unavailable image URLs are emitted.
- All 29 original records, the 18 pending photo IDs, captions, dates, original positions and historical variant hashes remain in private recovery metadata and local recovery files.
- The verified 33 objects (11 originals, 11 thumbnails, 11 full variants) retain their original keys and known IDs. Existing variants are copied byte-for-byte rather than regenerated.
- The existing historical local administrator salt/password hash is preserved; old sessions are cleared. The recovery is a new revision generation starting at zero because the latest Blob revision is inaccessible. Administrator identity is not replaced with a default password.
- Existing viewer likes are filtered to the available IDs by the unchanged Viewer. No new photo IDs or new likes-storage namespace is required.

## Server-side migration mechanism

`scripts/run-private-recovery.mjs` is a build-only runner, not an HTTP endpoint. A private input bundle is generated under ignored `.data/r2-recovery/private-build/` and deployed by the authenticated Vercel CLI to the existing project with production credentials and **`--skip-domain`**. The R2 secret remains in Vercel. No CLI `--token`, secret printing, migration API or public access to private input files is introduced.

The dry-run upload inventory has 46 files, including exactly 33 allowlisted media files; it has zero API routes and zero public input files. The runner writes only a generic status page and a counts/digest report to the configured `public` output directory. Private state and source media remain outside that public output.

The job first verifies every local input hash, then performs a synthetic R2 put/read/stat/create-only/CAS/stale-CAS/delete check. Only that newly created disposable synthetic object is deleted. It then copies the explicit 33-object inventory serially with destination checksum/type/size readback, verifies a private exact-byte initial-state backup, initializes R2 only if no control document exists, and compares the restored logical state to the prepared state. A different existing control state aborts rather than being overwritten.

The permanent Production S3 configuration is already stored in Vercel. Ordinary application builds remain network-free. Only this explicit migration job performs these R2 operations. No Vercel Blob reads, scans, writes or deletes occur.

## Release sequence

1. Complete local partial-state, missing-reference, privacy and Viewer checks.
2. Run the unassigned authenticated migration build; inspect its build result for successful live S3 and integrity verification. A failed credential or integrity check blocks the remaining sequence.
3. Stage the application with production R2 settings without assigning the public domain. Verify original album metadata, a minimal image sample, unauthorized access and absence of any migration endpoint.
4. Once all critical gates pass, update PR #2, merge the tested branch into the existing production branch and verify GitHub's production deployment is READY.
5. Verify `filmforus.space`, the original album URL, a small recovered-media sample and scoped runtime logs. Never promote the standalone recovery-job deployment to the public domain.

## Validation before the live job

- Production-mode build succeeds without storage operations.
- Offline tests verify unavailable photos are omitted from public content and sensitive recovery/admin metadata is never returned.
- Local actual-data API check: original album ID returns 200 with exactly 11 known IDs, zero pending-photo references; one thumbnail per roll decodes correctly.
- Local anonymous editor, upload and delete requests return 401.
- Local browser verifies Chinese/English controls, envelope opening, the 11-photo film table, recovered image display, new like, development, hanging and final collection.
- Live R2 and staged-production verification remain mandatory; these local results do not substitute for credentials/integrity checks.

## Rollback and preservation

Preserve the former production commit, source Blob objects, local SQLite and historical metadata. The new initial R2 state is backed up before cutover. The production data rollback target is an R2-compatible application deployment, not the exhausted Blob configuration. After any new writes, do not replay the initial-state backup over current R2 data.

Until the first R2-compatible application is proven in a production-environment staging deployment, there is no earlier working R2 production deployment to roll back to. That is a limitation of this first cutover; mitigate it by testing the staged application before merging/promoting and by retaining both staged application artifacts and immutable R2 snapshots. Do not claim recovery if the live job or staged checks fail.

## Adding missing originals later

Keep original files and their filenames. `scripts/rebuild-recovery-variants.mjs` regenerates the unchanged Sharp variants and matches both hashes to a unique historical photo ID; it never maps by filename order. Ambiguous/unmatched files require review. HEIC originals need the existing verified conversion path before an exact variant match can be asserted.

Copy the verified rebuilt inventory with `storage-migration.mjs copy-local`. Then run `storage-migration.mjs restore-pending <verified-inventory.json>` using an authorized server environment. The tool rechecks R2 hashes and historical image hashes, preserves the old photo IDs/captions/dates, appends the recovered records to the appropriate **draft** rolls, updates byte accounting and pending records with CAS protection, and leaves publication unchanged. Review ordering in the existing Album Editor and Publish when ready. The original public album URL does not change.

All private recovery state and photos stay under ignored `.data/`; none are committed to GitHub or emitted as public deployment artifacts.
