import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { initializeR2State, openR2Album, r2Paths, mediaKey } from "../server/r2-album.mjs";
import { StorageFailure } from "../server/object-storage.mjs";
import { createHandler } from "../server/index.mjs";
import { objectFixture, stateFixture } from "./support/object-fixture.mjs";

async function fixture(options) {
  const objects = objectFixture(), state = stateFixture();
  await initializeR2State(objects, state, "test");
  for (const id of state.uploaded) for (const variant of ["thumb", "full"]) await objects.put(mediaKey("test", state.album, id, variant), Buffer.from(`${variant}-${id}`), { contentType: "image/webp" });
  return { objects, state, store: openR2Album(objects, { prefix: "test", ...options }) };
}
async function request(handler, url, { cookie, body, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: body === undefined ? "GET" : "POST", url, headers: { origin: "https://offline.invalid", "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, socket: {} });
  const result = { headers: {} };
  const res = { setHeader: (k, v) => { result.headers[k.toLowerCase()] = v; }, writeHead: (s, hs) => { result.status = s; for (const [k, v] of Object.entries(hs)) res.setHeader(k, v); }, end: b => { result.body = b; } };
  await handler(req, res); return result;
}
test("R2 envelope round-trip preserves identity, snapshots, revisions, aliases and separates auth", async () => {
  const { objects, state, store } = await fixture();
  assert.deepEqual(await store.exportState(), state);
  const control = JSON.parse(objects.files.get(r2Paths("test").root).bytes);
  assert.ok(!JSON.stringify(control).includes(state.owner.password_hash));
  for (const [key, file] of objects.files) if (key.includes("snapshots")) assert.ok(!file.bytes.includes(state.owner.password_hash));
  assert.equal((await store.published("offline-fixture")).id, state.album.share_id);
  await assert.rejects(initializeR2State(objects, state, "test"), { status: 409 });
});
test("cached media and 304 still enforce immediate unpublish and photo bindings", async () => {
  const { objects, state, store } = await fixture(), id = state.uploaded[0], share = state.album.share_id;
  const first = await store.media(id, "full", share); assert.equal(first.status, 200);
  objects.calls.length = 0;
  const again = await store.media(id, "full", share); assert.deepEqual(again.bytes, first.bytes);
  assert.equal(objects.calls.filter(c => c.op === "read").length, 1); // Fresh control only.
  assert.equal((await store.media(id, "full", share, undefined, first.etag)).status, 304);
  await store.unpublish(0, share);
  await assert.rejects(store.media(id, "full", share, undefined, first.etag), { status: 404 });
  await assert.rejects(store.published("offline-fixture"), { status: 404 });
});
test("CAS rejects competing stale edits; uploads preserve photo ID on replacement", async () => {
  const { objects, state, store } = await fixture(), other = openR2Album(objects, { prefix: "test" });
  const managed = await store.manage();
  const outcomes = await Promise.allSettled([store.save(0, { ...managed.album, title: "First" }), other.save(0, { ...managed.album, title: "Second" })]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(r => r.status === "rejected").reason.status, 409);
  const updated = await store.manage(), asset = randomUUID(), photo = state.uploaded[0];
  await store.addPhoto(updated.revision, "roll-1", asset, { source: Buffer.from("original"), thumb: Buffer.from("thumb"), full: Buffer.from("full") }, state.album.share_id, photo);
  const draft = await store.manage(); assert.equal(draft.album.rolls[0].photos[0].id, photo);
  const old = await store.media(photo, "full", state.album.share_id); assert.ok(old.bytes.toString().startsWith("full-"));
  await store.publish(draft.revision);
  assert.equal((await store.media(photo, "full", state.album.share_id)).bytes.toString(), "full");
});
test("owner/session combine into one fresh auth read; revocation affects conditional preview", async () => {
  const { objects, state, store } = await fixture();
  const token = "c".repeat(64), tokenHash = createHash("sha256").update(token).digest("hex");
  await store.addSession(tokenHash, Date.now() + 60000);
  objects.calls.length = 0; assert.equal(await store.ownerAuthorized(tokenHash, false), true);
  assert.equal(objects.calls.filter(c => c.op === "read").length, 1);
  const handler = createHandler({ data: store, origin: "https://offline.invalid", allowStoredOwner: true });
  const url = `/api/editor/${state.album.share_id}/media/${state.uploaded[0]}/thumb`, cookie = `roll_session=${token}`;
  assert.equal((await request(handler, url)).status, 401);
  const first = await request(handler, url, { cookie }); assert.equal(first.status, 200); assert.equal(first.headers["cache-control"], "private, no-cache");
  assert.equal((await request(handler, url, { cookie, headers: { "if-none-match": first.headers.etag } })).status, 304);
  await store.deleteSession(tokenHash);
  assert.equal((await request(handler, url, { cookie, headers: { "if-none-match": first.headers.etag } })).status, 401);
  assert.equal((await request(handler, `/api/editor/${state.album.share_id}/upload`, { body: {} })).status, 401);
  assert.equal((await request(handler, `/api/editor/${state.album.share_id}/delete`, { body: {} })).status, 401);
});
test("write freeze rejects even login before storage mutation", async () => {
  const { objects, store } = await fixture(); objects.calls.length = 0;
  const handler = createHandler({ data: store, origin: "https://offline.invalid", writeFreeze: true });
  assert.equal((await request(handler, "/api/manage/login", { body: { password: "synthetic" } })).status, 503);
  assert.equal(objects.calls.length, 0);
});
test("control failure fails closed and fallback only reads allowlisted missing immutable media", async () => {
  let fallbackReads = 0;
  const fallback = { read: async () => { fallbackReads++; return { body: [Buffer.from("old")], size: 3 }; } };
  const { objects, state } = await fixture(), key = mediaKey("test", state.album, state.uploaded[0], "full");
  await objects.delete(key);
  const store = openR2Album(objects, { prefix: "test", fallback, fallbackKeys: [key] });
  assert.equal((await store.media(state.uploaded[0], "full", state.album.share_id)).bytes.toString(), "old");
  const absent = mediaKey("test", state.album, state.uploaded[1], "full"); await objects.delete(absent);
  await assert.rejects(store.media(state.uploaded[1], "full", state.album.share_id), { status: 404 });
  objects.fail(new StorageFailure("read", 403));
  await assert.rejects(store.media(state.uploaded[0], "full", state.album.share_id), StorageFailure);
  assert.equal(fallbackReads, 1);
});
test("missing initialization cannot create a blank album; byte cap is persisted and enforced", async () => {
  const empty = openR2Album(objectFixture(), { prefix: "test" }); await assert.rejects(empty.manage(), { status: 503 });
  const { store } = await fixture({ maxAlbumBytes: 5 });
  await assert.rejects(store.addPhoto(0, "roll-1", randomUUID(), { source: Buffer.from("12"), thumb: Buffer.from("34"), full: Buffer.from("56") }), { status: 422 });
  await store.addPhoto(0, "roll-1", randomUUID(), { source: Buffer.from("1"), thumb: Buffer.from("2"), full: Buffer.from("3") });
  assert.equal((await store.exportState()).album.storageBytes, 3);
  await assert.rejects(store.addPhoto(1, "roll-1", randomUUID(), { source: Buffer.from("1"), thumb: Buffer.from("2"), full: Buffer.from("3") }), { status: 422 });
});
