// Isolated, disposable browser QA. Never opens .data or contacts Blob.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { openAlbum } from "../server/album.mjs";
import { createApp } from "../server/index.mjs";
const directory = await mkdtemp(join(tmpdir(), "film-phase3-browser-"));
const dbPath = join(directory, "album.sqlite");
const data = openAlbum(dbPath);
let album = await data.create("Phase 3 browser check (sample photos)");
for (const [index, roll] of album.album.rolls.entries()) {
  const source = await readFile(new URL(`../public/samples/${["rain-1", "sea-1", "home-1"][index]}.webp`, import.meta.url));
  for (let i = 0; i < (index === 0 ? 2 : 1); i++) album = await data.addPhoto(album.revision, roll.id, randomUUID(), {
    source, full: source, thumb: await sharp(source).resize(480, 480, { fit: "inside" }).webp().toBuffer(),
  }, album.shareId);
}
album.album.letter = "A disposable browser test using the existing public sample photos.";
for (const roll of album.album.rolls) { roll.name = roll.id; for (const photo of roll.photos) photo.date = "2026-11-11"; }
album = await data.save(album.revision, album.album, album.shareId);
await data.publish(album.revision, album.shareId);
data.close();
const origin = "http://127.0.0.1:4183";
const server = createApp({ dbPath, origin, password: "local-phase-three-check" });
server.listen(4183, "127.0.0.1", () => console.log(`Disposable QA: ${origin}/editor · Password: local-phase-three-check`));
process.once("SIGINT", () => server.close(async () => { await rm(directory, { recursive: true, force: true }); process.exit(0); }));
