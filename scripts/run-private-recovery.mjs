// Build-only recovery job. Run in an authenticated Vercel production environment
// with --skip-domain. No API routes or private files are emitted to public/.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createR2Storage, r2Config } from "../server/r2-storage.mjs";
import { initializeR2State, openR2Album, r2Paths } from "../server/r2-album.mjs";
import { sha256, readBytes, StorageConflict } from "../server/object-storage.mjs";
import { copyInventory, requiredMedia, contentHash, verifyStateBackup } from "./storage-migration.mjs";

async function run() {
  if (process.env.VERCEL_ENV !== "production") throw new Error("This recovery job requires the intended production environment.");
  const stateBytes = await readFile("private-input/state.json"), state = JSON.parse(stateBytes);
  const journal = JSON.parse(await readFile("private-input/inventory.json"));
  const expected = requiredMedia(state);
  if (state.recovery?.mode !== "user-authorized-partial" || expected.length !== journal.objects.length
    || expected.some(e => !journal.objects.some(v => v.key === e.key))) throw new Error("Incomplete verified recovery input.");
  for (const o of journal.objects) {
    const bytes = await readFile(o.localFile);
    if (bytes.length !== o.size || sha256(bytes) !== o.sha256) throw new Error("Recovery input integrity failed.");
  }
  const objects = createR2Storage(r2Config());
  const synthetic = `_migration-validation/recovery-${randomUUID()}`, bytes = Buffer.from("Synthetic recovery credential/CAS test.");
  const first = await objects.put(synthetic, bytes, { createOnly: true, contentType: "text/plain" });
  assert.equal(sha256(await readBytes(await objects.read(synthetic))), sha256(bytes));
  assert.equal((await objects.stat(synthetic)).size, bytes.length);
  await assert.rejects(objects.put(synthetic, bytes, { createOnly: true }), StorageConflict);
  await objects.put(synthetic, Buffer.from("Updated synthetic verification."), { ifMatch: first.etag, contentType: "text/plain" });
  await assert.rejects(objects.put(synthetic, bytes, { ifMatch: first.etag }), StorageConflict);
  await objects.delete(synthetic); // Only this freshly created disposable object.
  assert.equal(await objects.read(synthetic), null);
  console.log("R2 synthetic read/write/stat/CAS/delete verification passed.");
  const source = { read: async key => {
    const o = journal.objects.find(o => (o.sourceReference ?? o.key) === key);
    if (!o) throw new Error("Recovery object is not allowlisted.");
    const bytes = await readFile(o.localFile);
    return { body: [bytes], size: bytes.length, contentType: o.contentType };
  } };
  const copied = await copyInventory({ source, destination: objects, journal, maxSourceReads: journal.objects.length });
  await verifyStateBackup(objects, stateBytes);
  const existing = await objects.read(r2Paths().root);
  if (!existing) await initializeR2State(objects, state);
  else await readBytes(existing); // Do not leave a response stream open.
  const store = openR2Album(objects), restored = await store.exportState();
  if (contentHash(restored) !== contentHash(state)) throw new Error("R2 state differs; recovery must not overwrite existing edits.");
  const publication = await store.published(state.album.share_id);
  const photoIds = publication.rolls.flatMap(r => r.photos.map(p => p.id));
  assert.deepEqual(photoIds, state.uploaded);
  assert.equal(publication.id, state.album.share_id);
  assert.equal(publication.recovery, undefined);
  for (const pending of state.recovery.pendingPhotos) await assert.rejects(store.media(pending.photo.id, "thumb", state.album.share_id), { status: 404 });
  const sample = await store.media(photoIds[0], "thumb", state.album.share_id);
  assert.equal(sample.status, 200);
  const authBefore = await objects.read(r2Paths().auth);
  const verify = await store.verifyExisting(state.album.share_id);
  assert.equal(verify.publishedPhotos, state.uploaded.length);
  // Exact recovery snapshot is the immutable initial rollback reference. Never
  // replace it with mutable state after public traffic resumes.
  const report = { result: "PASS", albumId: publication.id, recoveredPhotos: photoIds.length,
    pendingPhotos: state.recovery.pendingPhotos.length, verifiedObjects: copied.verified,
    stateSha256: contentHash(restored), authConfigured: !!state.owner, migrationApiCreated: false,
    syntheticStorageTests: "PASS", missingPhotosOmitted: true };
  await readBytes(authBefore);
  await mkdir("public", { recursive: true });
  await writeFile("public/index.html", "<!doctype html><meta charset=utf-8><title>Recovery job</title><p>Private recovery job completed.</p>");
  await writeFile("public/result.json", JSON.stringify(report));
  console.log("RECOVERY_RESULT", JSON.stringify(report));
}
try { await run(); }
catch (error) { console.error("Private recovery failed:", error.message); process.exitCode = 1; }
