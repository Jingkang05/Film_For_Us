import { sha256, StorageConflict } from "../../server/object-storage.mjs";
import { createState } from "../../server/blob-album.mjs";
export function objectFixture() {
  const files = new Map(), calls = []; let sequence = 0, failure;
  return {
    files, calls, fail(error) { failure = error; },
    async read(key) { calls.push({ op: "read", key }); if (failure) throw failure;
      const r = files.get(key); return r && { ...r, body: [Buffer.from(r.bytes)] }; },
    async put(key, bytes, options = {}) {
      calls.push({ op: "put", key, options }); if (failure) throw failure;
      const previous = files.get(key);
      if (options.createOnly && previous || options.ifMatch && previous?.etag !== options.ifMatch) throw new StorageConflict();
      const buffer = Buffer.from(bytes), etag = `"${++sequence}-${sha256(buffer)}"`;
      files.set(key, { bytes: buffer, size: buffer.length, etag, contentType: options.contentType, metadata: options.metadata ?? {} });
      return { etag };
    },
    async stat(key) { calls.push({ op: "stat", key }); if (failure) throw failure; const r = files.get(key); return r && { ...r }; },
    async delete(key) { calls.push({ op: "delete", key }); if (failure) throw failure; files.delete(key); },
    async signUpload(key, options) { calls.push({ op: "sign", key, options }); return { url: `https://synthetic.invalid/${key}`, headers: { "If-None-Match": "*" } }; },
  };
}
export function stateFixture() {
  const state = createState();
  state.album.share_id = "AAAAAAAAAAAAAAAA";
  state.owner = { salt: "a".repeat(32), password_hash: "b".repeat(128) };
  const content = JSON.parse(state.album.draft); content.title = "Offline fixture"; content.letter = "Synthetic only"; content.shareSlug = "offline-fixture";
  for (let i = 0; i < 3; i++) {
    content.rolls[i].name = `Synthetic roll ${i + 1}`;
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    content.rolls[i].photos.push({ id, note: `Synthetic caption ${i}`, date: "2026-11-11" }); state.uploaded.push(id);
  }
  state.album.draft = JSON.stringify(content); state.album.published = state.album.draft; state.album.published_revision = 0;
  return state;
}
