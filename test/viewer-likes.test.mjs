import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("../src/viewer-likes.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { loadViewerLikes, saveViewerLikes, viewerLikesKey } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const storage = () => {
  const records = new Map();
  return { records, getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
};

test("first visits are empty; a fresh viewer restores likes and unlikes across visits", () => {
  const disk = storage();
  const ids = ["photo-a", "photo-c", "photo-d", "photo-e"];
  assert.deepEqual(loadViewerLikes("album-1", ids, false, disk), []);
  saveViewerLikes("album-1", ["photo-a", "photo-c", "photo-e"], false, disk);
  assert.deepEqual(loadViewerLikes("album-1", ids, false, disk), ["photo-a", "photo-c", "photo-e"]);
  saveViewerLikes("album-1", ["photo-a", "photo-d", "photo-e"], false, disk);
  assert.deepEqual(loadViewerLikes("album-1", ids, false, disk), ["photo-a", "photo-d", "photo-e"]);
  saveViewerLikes("album-1", [], false, disk);
  assert.deepEqual(loadViewerLikes("album-1", ids, false, disk), []);
});

test("stored records contain only version, stable album ID and deduplicated photo IDs", () => {
  const disk = storage();
  saveViewerLikes("album-1", ["photo-a", "photo-a", "photo-c"], false, disk);
  assert.deepEqual(JSON.parse(disk.getItem(viewerLikesKey("album-1"))), {
    version: 1, albumId: "album-1", likedPhotoIds: ["photo-a", "photo-c"],
  });
});

test("reordering does not move likes; deleted and unknown photo IDs are omitted", () => {
  const disk = storage();
  saveViewerLikes("album-1", ["photo-a", "photo-c", "deleted"], false, disk);
  assert.deepEqual(loadViewerLikes("album-1", ["photo-c", "new", "photo-a"], false, disk), ["photo-a", "photo-c"]);
  assert.deepEqual(loadViewerLikes("album-1", [], false, disk), []);
});

test("albums and owner previews are isolated even when photo IDs overlap", () => {
  const disk = storage();
  saveViewerLikes("album-1", ["same-photo"], false, disk);
  saveViewerLikes("album-2", ["other-photo"], false, disk);
  saveViewerLikes("album-1", ["draft-only"], true, disk);
  const ids = ["same-photo", "other-photo", "draft-only"];
  assert.deepEqual(loadViewerLikes("album-1", ids, false, disk), ["same-photo"]);
  assert.deepEqual(loadViewerLikes("album-2", ids, false, disk), ["other-photo"]);
  assert.deepEqual(loadViewerLikes("album-1", ids, true, disk), ["draft-only"]);
  assert.notEqual(viewerLikesKey("preview:album-1"), viewerLikesKey("album-1", true));
});

test("renamed albums and public URL slugs reuse the same stable album ID", () => {
  const disk = storage();
  const album = { id: "immutable-id", title: "First title", shareSlug: "first-address", photos: ["a"] };
  saveViewerLikes(album.id, album.photos, false, disk);
  const renamed = { ...album, title: "New title", shareSlug: "new-address" };
  assert.deepEqual(loadViewerLikes(renamed.id, renamed.photos, false, disk), ["a"]);
  assert.equal(disk.records.size, 1);
});

test("missing, corrupted, wrong-version and wrong-album records are safely ignored", () => {
  const disk = storage();
  for (const record of ["{", "null", "[]", '"a"', JSON.stringify({ version: 2, albumId: "a", likedPhotoIds: ["p"] }),
    JSON.stringify({ version: 1, albumId: "other", likedPhotoIds: ["p"] }),
    JSON.stringify({ version: 1, albumId: "a", likedPhotoIds: "p" }),
    JSON.stringify({ version: 1, albumId: "a", likedPhotoIds: ["p", null] })]) {
    disk.setItem(viewerLikesKey("a"), record);
    assert.deepEqual(loadViewerLikes("a", ["p"], false, disk), []);
  }
});

test("blocked storage reads and quota failures never interrupt the viewer", t => {
  const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.deepEqual(loadViewerLikes("a", ["p"], false, blocked), []);
  assert.doesNotThrow(() => saveViewerLikes("a", ["p"], false, blocked));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage unavailable"); } });
  assert.deepEqual(loadViewerLikes("a", ["p"]), []);
  assert.doesNotThrow(() => saveViewerLikes("a", ["p"]));
});

test("rapid updates persist the latest selection synchronously", () => {
  const disk = storage();
  for (let i = 0; i < 101; i++) saveViewerLikes("a", i % 2 === 0 ? ["p"] : [], false, disk);
  assert.deepEqual(loadViewerLikes("a", ["p"], false, disk), ["p"]);
  saveViewerLikes("a", [], false, disk);
  assert.deepEqual(loadViewerLikes("a", ["p"], false, disk), []);
});
