import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { processPhoto } from "../server/index.mjs";
import { sha256 } from "../server/object-storage.mjs";
import { saveJournal } from "./storage-migration.mjs";

// Match by BOTH recorded production variant hashes, never filename/order.
export async function rebuildVerifiedVariants({ files, manifest, directory }) {
  if (files.length > 500) throw new Error("Review source batches of at most 500 files.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const hashes = new Map();
  for (const id of new Set(manifest.images.map(r => r.photoId))) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid stable photo ID in recovery manifest.");
    const thumb = manifest.images.find(r => r.photoId === id && r.variant === "thumb")?.sha256;
    const full = manifest.images.find(r => r.photoId === id && r.variant === "full")?.sha256;
    if (!thumb || !full) throw new Error("Production variant hashes are incomplete.");
    const key = `${thumb}:${full}`; hashes.set(key, [...(hashes.get(key) ?? []), id]);
  }
  const objects = [], matched = new Set(), unresolved = [];
  for (const file of files) {
    try {
      const info = await stat(file); if (!info.isFile()) continue;
      if (info.size > 20 * 1024 * 1024) throw new Error("Original exceeds the 20 MiB upload limit.");
      const original = await readFile(file), variants = await processPhoto(original);
      const ids = hashes.get(`${sha256(variants.thumb)}:${sha256(variants.full)}`) ?? [];
      if (ids.length !== 1) { unresolved.push({ file, reason: ids.length ? "Multiple stable IDs share identical variants; mapping needs review." : "Regenerated hashes do not match the production manifest." }); continue; }
      const id = ids[0]; if (matched.has(id)) continue;
      const photoObjects = [];
      for (const variant of ["source", "thumb", "full"]) {
        const bytes = variants[variant], localFile = join(directory, `${id}-${variant}`);
        // Preserve preexisting recovery output; never replace an unexplained file.
        try { await writeFile(localFile, bytes, { flag: "wx", mode: 0o600 }); }
        catch (error) { if (error.code !== "EEXIST" || sha256(await readFile(localFile)) !== sha256(bytes)) throw error; }
        photoObjects.push({ albumId: manifest.albumId, photoId: id, key: `roll-for-us/media/${id}/${variant}`, variant,
          localFile, sourceFilename: file, sourceProvider: "verified-original-file", sourceReference: `${id}/${variant}`,
          size: bytes.length, contentType: variant === "source" ? "application/octet-stream" : "image/webp", sha256: sha256(bytes), status: "pending" });
      }
      matched.add(id); objects.push(...photoObjects);
    } catch (error) { unresolved.push({ file, reason: error.status === 415 ? "Unsupported source; HEIC requires the existing verified browser conversion path." : error.message }); }
  }
  return { version: 1, albumId: manifest.albumId, objects, unresolved, missingPhotoIds: [...new Set(manifest.images.map(r => r.photoId))].filter(id => !matched.has(id)), readyForProduction: false };
}
async function main() {
  const [input, manifestFile, output] = process.argv.slice(2);
  if (!output) throw new Error("Usage: rebuild-recovery-variants.mjs <originals-directory> <verified-release-manifest.json> <private-output-directory>");
  const entries = await readdir(input, { withFileTypes: true });
  const report = await rebuildVerifiedVariants({ files: entries.filter(e => e.isFile()).map(e => resolve(input, e.name)),
    manifest: JSON.parse(await readFile(manifestFile, "utf8")), directory: resolve(output) });
  await saveJournal(join(output, "rebuilt-inventory.json"), report);
  console.log(JSON.stringify({ recoveredPhotos: report.objects.length / 3, unresolvedFiles: report.unresolved.length, missingPhotoIds: report.missingPhotoIds.length, readyForProduction: false }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
