import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { sha256 } from "../server/object-storage.mjs";
import { contentHash, saveJournal } from "./storage-migration.mjs";

const [dbFile, baselineFile, manifestFile, outputDirectory] = process.argv.slice(2);
if (!outputDirectory) throw new Error("Usage: recover-local-album.mjs <readonly.sqlite> <saved-public-album.json> <release-manifest.json> <private-output-directory>");
const directory = resolve(outputDirectory);
await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
const baseline = JSON.parse(await readFile(baselineFile, "utf8")), manifest = JSON.parse(await readFile(manifestFile, "utf8"));
if (baseline.id !== manifest.albumId || contentHash(baseline) !== manifest.contentSha256) throw new Error("Saved public metadata does not match the release verification manifest.");
const db = new DatabaseSync(resolve(dbFile), { readOnly: true });
try {
  const row = db.prepare("SELECT share_id,revision,published_revision,draft,published FROM album WHERE id=1").get();
  if (row?.share_id !== baseline.id) throw new Error("Local album identity mismatch.");
  const media = new Map(db.prepare("SELECT id,source,thumb,full FROM media").all().map(r => [r.id, r]));
  const inventory = [], missing = [];
  for (const photo of baseline.rolls.flatMap(r => r.photos)) {
    const local = media.get(photo.id);
    const references = manifest.images.filter(i => i.photoId === photo.id);
    const valid = local && ["thumb", "full"].every(v => references.some(ref => ref.variant === v && sha256(local[v]) === ref.sha256));
    if (!valid) { missing.push({ albumId: baseline.id, photoId: photo.id, reason: local ? "local variant checksum mismatch" : "original/variants absent locally" }); continue; }
    for (const variant of ["source", "thumb", "full"]) {
      const bytes = Buffer.from(local[variant]), file = join(directory, `${photo.id}-${variant}`);
      await writeFile(file, bytes, { mode: 0o600 }); await chmod(file, 0o600);
      inventory.push({ albumId: baseline.id, photoId: photo.id, key: `roll-for-us/media/${photo.id}/${variant}`, variant,
        localFile: file, sourceProvider: "local-sqlite", sourceReference: `${photo.id}/${variant}`, size: bytes.length,
        contentType: variant === "source" ? "application/octet-stream" : "image/webp", sha256: sha256(bytes), status: "pending",
        provenance: variant === "source" ? "local original associated by matching ID and both verified optimized variants" : "matches production release SHA-256" });
    }
  }
  await writeFile(join(directory, "published-content.json"), JSON.stringify(baseline, null, 2), { mode: 0o600 });
  await saveJournal(join(directory, "inventory.json"), { version: 1, objects: inventory });
  const report = { albumId: baseline.id, publishedMetadata: "verified against historical production manifest", contentSha256: manifest.contentSha256,
    baselinePhotos: baseline.rolls.reduce((n, r) => n + r.photos.length, 0), recoveredPhotos: inventory.length / 3, missing,
    localRevision: row.revision, localPublishedRevision: row.published_revision,
    currentProductionRevision: "unknown", currentDraftsAndOtherAlbums: "not recovered", aliasHistory: "not exposed in saved public API",
    administrator: "historical local credential exists; current production credential not verified", readyForProduction: false,
    sources: { sqlite: resolve(dbFile), baseline: resolve(baselineFile), manifest: resolve(manifestFile) } };
  await saveJournal(join(directory, "recovery-report.json"), report);
  console.log(JSON.stringify({ albumId: report.albumId, baselinePhotos: report.baselinePhotos, recoveredPhotos: report.recoveredPhotos,
    missingPhotos: missing.length, verifiedOptimizedVariants: inventory.filter(i => i.variant !== "source").length, readyForProduction: false }));
} finally { db.close(); }
