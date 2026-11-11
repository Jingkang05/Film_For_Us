import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createApp } from "../server/index.mjs";

const origin = "http://127.0.0.1";
test("multiple albums: owner gates, independent edits/uploads, versioned replacement, publication and restart", async t => {
  const directory = await mkdtemp(join(tmpdir(), "film-multi-"));
  const dbPath = join(directory, "album.sqlite"), password = randomUUID();
  let server, base, cookie;
  async function start() { server = createApp({ dbPath, password, origin }); server.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, value, auth = true, from = origin) => fetch(base + path, {
    method: value === undefined ? "GET" : "POST", headers: { ...(auth && cookie ? { Cookie: cookie } : {}),
      ...(value !== undefined ? { Origin: from, "Content-Type": Buffer.isBuffer(value) ? "image/png" : "application/json" } : {}) },
    body: value === undefined ? undefined : Buffer.isBuffer(value) ? value : JSON.stringify(value),
  });
  async function json(path, value, expected = 200) { const response = await request(path, value); const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body; }
  await start();
  for (const path of ["/api/editor", "/api/editor/AAAAAAAAAAAAAAAA", "/api/editor/AAAAAAAAAAAAAAAA/preview", `/api/editor/AAAAAAAAAAAAAAAA/media/${randomUUID()}/full`]) assert.equal((await request(path)).status, 401);
  for (const op of ["save", "publish", "unpublish", "delete", "upload", "upload-target"]) assert.equal((await request(`/api/editor/AAAAAAAAAAAAAAAA/${op}`, {})).status, 401);
  assert.equal((await request("/api/editor/create", {})).status, 401);
  const login = await request("/api/manage/login", { password }); cookie = login.headers.get("set-cookie").split(";")[0]; const legacy = await login.json();
  assert.equal((await request("/api/editor/create", { title: "No CSRF" }, true, "https://foreign.test")).status, 403);
  let a = await json("/api/editor/create", { title: "Album A" }, 201);
  let b = await json("/api/editor/create", { title: "Album B" }, 201);
  const route = (album, op) => `/api/editor/${album.shareId}${op ? `/${op}` : ""}`;
  assert.notEqual(a.shareId, b.shareId); assert.notEqual(a.shareId, legacy.shareId);
  assert.equal(a.status, "draft"); assert.equal(a.album.letter, ""); assert.equal(a.album.rolls.flatMap(r => r.photos).length, 0);
  assert.equal((await json("/api/editor")).albums.length, 3);
  assert.equal((await request(`/api/a/${a.shareId}`, undefined, false)).status, 404);
  assert.equal((await request(route(a, "preview"), undefined, false)).status, 401);
  await json(route(a, "publish"), { revision: 0 }, 422);
  await json("/api/editor/AAAAAAAAAAAAAAAA", undefined, 404);
  await json(route(a, "save"), { revision: 0, album: null }, 422);
  const image = await sharp({ create: { width: 90, height: 60, channels: 3, background: "#eecc99" } }).png().toBuffer();
  const replacement = await sharp({ create: { width: 60, height: 90, channels: 3, background: "#224455" } }).png().toBuffer();
  for (const roll of a.album.rolls) {
    const asset = randomUUID();
    a = await json(route(a, `upload?id=${asset}&roll=${roll.id}&revision=${a.revision}`), image);
    // Same ID in another album must not deduplicate against A or read A's files.
    b = await json(route(b, `upload?id=${asset}&roll=${roll.id}&revision=${b.revision}`), replacement);
  }
  const extra = randomUUID(); a = await json(route(a, `upload?id=${extra}&roll=roll-1&revision=${a.revision}`), image);
  const originalIds = a.album.rolls.flatMap(r => r.photos.map(p => p.id));
  a.album.rolls[0].photos.reverse();
  a.album.letter = "A generic test memory"; a.album.shareSlug = "album-a";
  a.album.description = "For records"; a.album.ending = { instantCaption: "Collected light" };
  a.album.settings = { sealMotif: "branch", music: { title: "Test soundtrack label", src: "/assets/who-knows.m4a?v=2" } };
  for (const roll of a.album.rolls) { roll.name = roll.id; for (const photo of roll.photos) photo.date = "2026-11-11"; }
  const stale = a.revision;
  a = await json(route(a, "save"), { revision: a.revision, album: a.album });
  assert.equal(a.album.rolls[0].photos[0].id, extra);
  assert.deepEqual(new Set(a.album.rolls.flatMap(r => r.photos.map(p => p.id))), new Set(originalIds));
  await json(route(a, "save"), { revision: stale, album: a.album }, 409);
  await json(route(a, "upload") + `?id=${randomUUID()}&roll=roll-1&revision=${stale}`, image, 409);
  await json(route(a, "save"), { revision: a.revision, album: { ...a.album, settings: { ...a.album.settings, music: { title: "Unsafe", src: "javascript:alert(1)" } } } }, 422);
  a = await json(route(a, "publish"), { revision: a.revision });
  const publicA = await json(`/api/a/${a.shareId}`);
  assert.equal(publicA.settings.sealMotif, "branch"); assert.equal(publicA.ending.instantCaption, "Collected light");
  const photo = a.album.rolls[0].photos[0], publicPhoto = publicA.rolls[0].photos[0];
  const beforeBytes = Buffer.from(await (await request(publicPhoto.full, undefined, false)).arrayBuffer());
  assert.equal((await request(photo.full, undefined, false)).status, 401);
  // Injected media URLs and asset pointers cannot claim another album's data.
  b.album.rolls[0].photos[0].full = photo.full; b.album.rolls[0].photos[0].assetId = "foreign";
  b = await json(route(b, "save"), { revision: b.revision, album: b.album });
  assert.notEqual(b.album.rolls[0].photos[0].full, photo.full);
  assert.equal((await json(route(b))).album.letter, "");
  const asset = randomUUID();
  a = await json(route(a, `upload?id=${asset}&replace=${photo.id}&roll=roll-1&revision=${a.revision}`), replacement);
  assert.equal(a.album.rolls[0].photos[0].id, photo.id);
  assert.equal(a.album.rolls[0].photos[0].assetId, undefined);
  assert.deepEqual(Buffer.from(await (await request(publicPhoto.full, undefined, false)).arrayBuffer()), beforeBytes);
  assert.notDeepEqual(Buffer.from(await (await request(a.album.rolls[0].photos[0].full)).arrayBuffer()), beforeBytes);
  b.album.letter = "A second independent generic memory";
  for (const roll of b.album.rolls) { roll.name = roll.id; for (const photo of roll.photos) photo.date = "2026-11-11"; }
  b = await json(route(b, "save"), { revision: b.revision, album: b.album });
  b = await json(route(b, "publish"), { revision: b.revision });
  assert.equal((await json(`/api/a/${b.shareId}`)).title, "Album B");
  const priorRevision = a.revision;
  a = await json(route(a, "publish"), { revision: a.revision });
  assert.notDeepEqual(Buffer.from(await (await request(publicPhoto.full, undefined, false)).arrayBuffer()), beforeBytes);
  await json(route(a, "unpublish"), { revision: priorRevision }, 409);
  a = await json(route(a, "unpublish"), { revision: a.revision });
  for (const url of [`/api/a/${a.shareId}`, "/api/a/album-a", publicPhoto.full]) assert.equal((await request(url, undefined, false)).status, 404);
  assert.equal((await json(route(a, "preview"))).id, a.shareId);
  await json(route(a, "unpublish"), { revision: a.revision }, 422);
  b.album.shareSlug = "album-a"; await json(route(b, "save"), { revision: b.revision, album: b.album }, 409); b.album.shareSlug = "";
  a = await json(route(a, "publish"), { revision: a.revision });
  assert.equal((await request(`/api/a/${a.shareId}`, undefined, false)).status, 200);
  await stop(); await start();
  const restored = await json(route(a));
  assert.deepEqual(restored, a);
  assert.equal((await json(route(b))).album.title, "Album B");
  assert.equal((await json(`/api/a/${a.shareId}`)).rolls[0].photos[0].id, photo.id);
  await json(route(a, "delete"), { revision: a.revision, confirmation: b.shareId }, 422);
  await json(route(a, "delete"), { revision: a.revision - 1, confirmation: a.shareId }, 409);
  await json(route(a, "delete"), { revision: a.revision, confirmation: a.shareId });
  assert.equal((await request(`/api/a/${a.shareId}`, undefined, false)).status, 404);
  await json(route(a), undefined, 404); await json(route(a, "preview"), undefined, 404);
  assert.equal((await json("/api/editor")).albums.length, 2);
  assert.equal((await json(route(b))).album.title, "Album B");
  assert.equal((await request(`/api/a/${b.shareId}`, undefined, false)).status, 200);
  // Deleting the legacy album must not prevent the administrator from signing back in.
  await json(`/api/editor/${legacy.shareId}/delete`, { revision: legacy.revision, confirmation: legacy.shareId });
  await json("/api/manage/logout", {});
  assert.equal((await request("/api/manage/login", { password })).status, 200);
});
