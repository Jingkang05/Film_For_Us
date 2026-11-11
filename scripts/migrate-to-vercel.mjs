import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { get, put } from "@vercel/blob";
import { validateState } from "../server/collection.mjs";
import { albumStatePath, createState, photoPath } from "../server/blob-album.mjs";

const prefix = "roll-for-us";
const db = new DatabaseSync(resolve(process.argv[2] ?? ".data/album.sqlite"), { readOnly: true });
const access = "private";

async function copy(path, bytes, contentType) {
  try {
    await put(path, bytes, { access, contentType });
  } catch (error) {
    const existing = await get(path, { access, useCache: false });
    if (!existing) throw error;
    const stored = Buffer.from(await new Response(existing.stream).arrayBuffer());
    if (!stored.equals(Buffer.from(bytes))) throw new Error(`Cloud file already exists with different contents: ${path}`);
  }
}

try {
  const path = albumStatePath(prefix);
  if (await get(path, { access, useCache: false })) {
    throw new Error("The cloud album already exists. Import stopped before copying any files.");
  }
  const collection = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'album_collection'").get();
  db.exec("BEGIN");
  const savedCollection = collection ? JSON.parse(db.prepare("SELECT state FROM album_collection WHERE id = 1").get().state) : null;
  const album = savedCollection?.album ?? db.prepare("SELECT share_id, revision, draft, published_revision, published FROM album WHERE id = 1").get();
  if (!album) throw new Error("The local database has no album.");
  const owner = savedCollection?.owner ?? db.prepare("SELECT salt, password_hash FROM local_owner WHERE id = 1").get();
  const ids = [];
  for (const { id, source, thumb, full } of db.prepare("SELECT id, source, thumb, full FROM media ORDER BY id").iterate()) {
    const [albumId, assetId] = id.includes("/") ? id.split("/") : [null, id];
    if (albumId && !savedCollection?.albums?.some(row => row.share_id === albumId)) throw new Error("Unknown media ownership. Import stopped.");
    const targetPrefix = albumId ? `${prefix}/albums/${albumId}` : prefix;
    await Promise.all([
      copy(photoPath(targetPrefix, assetId, "source"), source, "application/octet-stream"),
      copy(photoPath(targetPrefix, assetId, "thumb"), thumb, "image/webp"),
      copy(photoPath(targetPrefix, assetId, "full"), full, "image/webp"),
    ]);
    ids.push(id);
    console.log(`Copied photo ${ids.length}`);
  }
  const state = savedCollection ?? createState(album, owner, ids);
  state.sessions = {}; state.attempts = {}; delete state.uploadAttempts;
  validateState(state);
  await put(path, JSON.stringify(state), { access, contentType: "application/json" });
  console.log(`Imported ${ids.length} photos and album revision ${album.revision} (published revision ${album.published_revision}).`);
} finally {
  db.close();
}
