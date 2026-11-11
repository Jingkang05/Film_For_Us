import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { BlobNotFoundError, BlobPreconditionFailedError } from "@vercel/blob";
import { collectionStore } from "../server/collection.mjs";
import { openBlobAlbum, createState, albumStatePath, photoPath } from "../server/blob-album.mjs";

function memoryBlob(initial) {
  const files = new Map(), path = albumStatePath("test");
  let sequence = 0, conflicts = 0, fail = false, badBackup = false;
  const store = (path, bytes) => { const record = { bytes: Buffer.from(bytes), etag: `"${++sequence}"` }; files.set(path, record); return record; };
  store(path, JSON.stringify(initial));
  return {
    files, store, conflict() { conflicts++; }, fail(value) { fail = value; }, badBackup(value) { badBackup = value; },
    async get(path) { const file = files.get(path); return file && { stream: new Response(file.bytes).body, blob: { etag: file.etag, size: file.bytes.length } }; },
    async head(path) { if (!files.has(path)) throw new BlobNotFoundError(); return {}; },
    async put(target, bytes, options) {
      if (fail) throw new Error("storage unavailable");
      if (target === path && conflicts) { conflicts--; const state = JSON.parse(files.get(path).bytes); state.sessions.other = Date.now() + 10000; store(path, JSON.stringify(state)); throw new BlobPreconditionFailedError(); }
      if (options.ifMatch && options.ifMatch !== files.get(target)?.etag) throw new BlobPreconditionFailedError();
      if (!options.allowOverwrite && files.has(target)) throw new Error("already exists");
      return store(target, badBackup && target.includes("backups/") ? "{}" : bytes);
    },
    async issueSignedToken() { return "scoped-token"; },
    async presignUrl(token, options) { return { presignedUrl: `https://example.test/${options.pathname}` }; },
  };
}
const legacyState = () => {
  const state = createState(); state.album.share_id = "OhqQkmPtTAlxEkHH";
  const album = JSON.parse(state.album.draft); album.title = "Legacy synthetic fixture"; album.letter = "Synthetic, no private data";
  for (const roll of album.rolls) { roll.name = roll.id; const id = randomUUID(); roll.photos.push({ id, note: "", date: "2026-11-11" }); state.uploaded.push(id); }
  state.album.draft = JSON.stringify(album); state.album.published = state.album.draft; state.album.published_revision = 0;
  return state;
};
test("Blob additive conversion verifies backup, preserves legacy bytes/paths, retries CAS and survives reopen", async () => {
  const initial = legacyState(), blob = memoryBlob(initial), store = openBlobAlbum("test", blob);
  const publicBefore = await store.published(initial.album.share_id);
  for (const id of initial.uploaded) { blob.store(photoPath("test", id, "full"), "legacy-photo"); blob.store(photoPath("test", id, "thumb"), "legacy-thumb"); }
  const mediaBefore = [...blob.files].filter(([path]) => path.includes("/media/")).map(([path, file]) => [path, file.bytes.toString()]);
  blob.conflict();
  const a = await store.create("Album A"), b = await store.create("Album B");
  const saved = JSON.parse(blob.files.get(albumStatePath("test")).bytes);
  assert.equal(saved.schemaVersion, 2);
  assert.deepEqual(saved.album, initial.album);
  assert.ok(saved.sessions.other);
  assert.ok(saved.phase3Backup.includes("pre-phase-3-"));
  const backups = [...blob.files].filter(([path]) => path.includes("backups/"));
  assert.ok(backups.some(([, file]) => file.bytes.toString() === JSON.stringify(initial)));
  assert.deepEqual(await store.published(initial.album.share_id), publicBefore);
  assert.deepEqual([...blob.files].filter(([path]) => path.includes("/media/")).map(([path, file]) => [path, file.bytes.toString()]), mediaBefore);
  a.album.title = "Edited A";
  const versions = await Promise.allSettled([store.save(0, a.album, a.shareId), store.save(0, { ...a.album, title: "Stale A" }, a.shareId)]);
  assert.equal(versions.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(versions.find(result => result.status === "rejected").reason.status, 409);
  assert.equal((await store.manage(b.shareId)).album.title, "Album B");
  const reopened = openBlobAlbum("test", blob);
  assert.equal((await reopened.list()).length, 3);
  assert.equal((await reopened.manage(a.shareId)).revision, 1);
  const id = randomUUID();
  assert.ok((await store.uploadTarget(id, 1, 100, a.shareId)).url.includes(`/albums/${a.shareId}/media/`));
  assert.ok((await store.uploadTarget(id, 0, 100)).url.includes(`/test/media/${id}/source`));
  blob.fail(true);
  await assert.rejects(store.save(1, { ...a.album, title: "Failed save" }, a.shareId), /unavailable/);
  blob.fail(false);
  assert.equal((await store.manage(a.shareId)).album.title, "Edited A");
  blob.fail(true);
  await assert.rejects(store.addPhoto(1, "roll-1", id, { thumb: Buffer.from("thumb"), full: Buffer.from("full") }, a.shareId), /unavailable/);
  blob.fail(false);
  assert.equal(await store.hasUpload(id, a.shareId), false);
  await store.addPhoto(1, "roll-1", id, { thumb: Buffer.from("thumb"), full: Buffer.from("full") }, a.shareId);
  assert.equal(await store.hasUpload(id, b.shareId), false);
  await assert.rejects(store.uploadSource(randomUUID(), 100, a.shareId), { status: 422 });
  blob.store(photoPath(`test/albums/${a.shareId}`, id, "source"), Buffer.alloc(101));
  await assert.rejects(store.uploadSource(id, 100, a.shareId), { status: 413 });
});
test("a failed or corrupted backup blocks conversion before any production metadata changes", async () => {
  for (const corrupt of [true, false]) {
    const initial = legacyState(), blob = memoryBlob(initial), store = openBlobAlbum("test", blob);
    if (corrupt) blob.badBackup(true); else blob.fail(true);
    await assert.rejects(store.create("Will fail"));
    assert.deepEqual(JSON.parse(blob.files.get(albumStatePath("test")).bytes), initial);
  }
});
test("invalid stored state fails closed and persistent login throttling survives instance restart", async () => {
  const initial = legacyState(), blob = memoryBlob(initial), store = openBlobAlbum("test", blob);
  for (let i = 0; i < 8; i++) await store.recordLoginAttempt("test-ip");
  await assert.rejects(openBlobAlbum("test", blob).recordLoginAttempt("test-ip"), { status: 429 });
  blob.store(albumStatePath("test"), JSON.stringify({ ...initial, schemaVersion: 999 }));
  await assert.rejects(store.manage(), { status: 503 });
});

test("duplicate album IDs are rejected and throttling is persisted", async () => {
  const state = legacyState();
  const store = collectionStore({ snapshot: async () => ({ state }), change: async update => update(state),
    newAlbum: () => ({ ...state.album }), writeMedia: async () => {}, readMedia: async () => {} });
  await assert.rejects(store.create("Collision"), { status: 409 });
  for (let i = 0; i < 180; i++) await store.recordUploadAttempt("session");
  await assert.rejects(store.recordUploadAttempt("session"), { status: 429 });
});

test("production build preflight verifies administrator, backup and every referenced asset without changing live metadata", async () => {
  const initial = legacyState(); initial.owner = { salt: "a".repeat(32), password_hash: "b".repeat(128) };
  const blob = memoryBlob(initial), store = openBlobAlbum("test", blob);
  const originalBytes = Buffer.from(blob.files.get(albumStatePath("test")).bytes);
  for (const id of initial.uploaded) for (const variant of ["source", "thumb", "full"]) blob.store(photoPath("test", id, variant), variant);
  const result = await store.verifyExisting(initial.album.share_id);
  assert.equal(result.publishedPhotos, 3); assert.equal(result.verifiedAssets, 3);
  assert.deepEqual(blob.files.get(result.backupPath).bytes, originalBytes);
  assert.deepEqual(blob.files.get(albumStatePath("test")).bytes, originalBytes);
  blob.files.delete(photoPath("test", initial.uploaded[0], "source"));
  await assert.rejects(store.verifyExisting(initial.album.share_id));
  await assert.rejects(store.verifyExisting("incorrect-id"));
  assert.deepEqual(blob.files.get(albumStatePath("test")).bytes, originalBytes);
});
