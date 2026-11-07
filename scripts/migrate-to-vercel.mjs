import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { get, put } from "@vercel/blob";
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
  db.exec("BEGIN");
  const album = db.prepare("SELECT share_id, revision, draft, published_revision, published FROM album WHERE id = 1").get();
  if (!album) throw new Error("The local database has no album.");
  const owner = db.prepare("SELECT salt, password_hash FROM local_owner WHERE id = 1").get();
  const ids = [];
  for (const { id, source, thumb, full } of db.prepare("SELECT id, source, thumb, full FROM media ORDER BY id").iterate()) {
    await Promise.all([
      copy(photoPath(prefix, id, "source"), source, "application/octet-stream"),
      copy(photoPath(prefix, id, "thumb"), thumb, "image/webp"),
      copy(photoPath(prefix, id, "full"), full, "image/webp"),
    ]);
    ids.push(id);
    console.log(`Copied photo ${ids.length}`);
  }
  await put(path, JSON.stringify(createState(album, owner, ids)), { access, contentType: "application/json" });
  console.log(`Imported ${ids.length} photos and album revision ${album.revision} (published revision ${album.published_revision}).`);
} finally {
  db.close();
}
