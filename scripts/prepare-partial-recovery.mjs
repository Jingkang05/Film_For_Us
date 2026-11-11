import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateState } from "../server/collection.mjs";
import { sha256 } from "../server/object-storage.mjs";
import { contentHash, saveJournal } from "./storage-migration.mjs";

export function partialRecoveryState({ album, releaseManifest, inventory, owner }) {
  if (album.id !== releaseManifest.albumId || contentHash(album) !== releaseManifest.contentSha256) throw new Error("Historical publication checksum/identity mismatch.");
  if (!/^[a-f0-9]{32}$/.test(owner?.salt ?? "") || !/^[a-f0-9]{128}$/.test(owner?.password_hash ?? "")) throw new Error("Verified historical administrator protection is required.");
  const allPhotos = album.rolls.flatMap(r => r.photos), ids = new Set(allPhotos.map(p => p.id));
  const available = new Set();
  for (const id of new Set(inventory.objects.map(o => o.photoId))) {
    if (!ids.has(id)) throw new Error("Unmapped recovery photo.");
    for (const variant of ["source", "thumb", "full"]) {
      const entries = inventory.objects.filter(o => o.photoId === id && o.variant === variant);
      if (entries.length !== 1 || entries[0].key !== `roll-for-us/media/${id}/${variant}` || !/^[a-f0-9]{64}$/.test(entries[0].sha256)) throw new Error("Incomplete or ambiguous recovery media.");
      if (variant !== "source" && !releaseManifest.images.some(i => i.photoId === id && i.variant === variant && i.sha256 === entries[0].sha256)) throw new Error("Optimized variant differs from historical production.");
    }
    available.add(id);
  }
  if (!available.size) throw new Error("No verified photographs available.");
  const photoContent = photo => Object.fromEntries(Object.entries(photo).filter(([k]) => !["thumb", "full", "assetId"].includes(k)));
  const { id, rolls, ...metadata } = album;
  const partial = { ...metadata, rolls: rolls.map(roll => ({ ...roll, photos: roll.photos.filter(p => available.has(p.id)).map(photoContent) })) };
  const pendingPhotos = rolls.flatMap(roll => roll.photos.flatMap((p, position) => available.has(p.id) ? [] : [{ rollId: roll.id, position, photo: photoContent(p) }]));
  const state = { schemaVersion: 2,
    album: { share_id: id, revision: 0, published_revision: 0, status: "published", legacy: true,
      draft: JSON.stringify(partial), published: JSON.stringify(partial), storageBytes: inventory.objects.reduce((n, o) => n + o.size, 0) },
    uploaded: allPhotos.filter(p => available.has(p.id)).map(p => p.id), owner, sessions: {}, attempts: {},
    recovery: { version: 1, mode: "user-authorized-partial", source: "checksum-verified historical public snapshot",
      historicalContentSha256: releaseManifest.contentSha256, originalPublished: album, variantManifest: releaseManifest,
      pendingPhotos, originalPhotoCount: allPhotos.length, recoveredPhotoCount: available.size,
      currentProductionRevisionUnknown: true, authenticationSource: "historical local owner record; sessions reset",
      revisionPolicy: "New recovery generation starts at revision zero; latest Blob revision is unavailable." } };
  validateState(state); return state;
}
async function main() {
  const [dbFile, albumFile, manifestFile, inventoryFile, outputFile] = process.argv.slice(2);
  if (!outputFile) throw new Error("Usage: prepare-partial-recovery.mjs <readonly.sqlite> <historical-public.json> <release-manifest.json> <local-inventory.json> <private-state.json>");
  const album = JSON.parse(await readFile(albumFile)), releaseManifest = JSON.parse(await readFile(manifestFile)), inventory = JSON.parse(await readFile(inventoryFile));
  for (const o of inventory.objects) {
    const bytes = await readFile(o.localFile);
    if (bytes.length !== o.size || sha256(bytes) !== o.sha256) throw new Error("Local recovered file failed integrity verification.");
  }
  const db = new DatabaseSync(resolve(dbFile), { readOnly: true });
  try {
    const owner = db.prepare("SELECT salt,password_hash FROM local_owner WHERE id=1").get();
    const state = partialRecoveryState({ album, releaseManifest, inventory, owner });
    await saveJournal(outputFile, state);
    console.log(JSON.stringify({ albumId: state.album.share_id, recovered: state.uploaded.length, pending: state.recovery.pendingPhotos.length, stateSha256: contentHash(state) }));
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
