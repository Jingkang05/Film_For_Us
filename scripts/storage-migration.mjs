import { readFile, writeFile, rename, mkdir, chmod } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { StorageConflict, readBytes, sha256 } from "../server/object-storage.mjs";
import { validateState } from "../server/collection.mjs";
import { mediaKey, initializeR2State, openR2Album } from "../server/r2-album.mjs";
import { createR2Storage, r2Config } from "../server/r2-storage.mjs";

export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const contentHash = value => sha256(JSON.stringify(canonical(value)));
export function requiredMedia(state, prefix = "roll-for-us") {
  validateState(state);
  const entries = new Map();
  for (const row of [state.album, ...(state.albums ?? [])]) {
    const snapshots = [row.draft, row.published].filter(Boolean).map(JSON.parse);
    const referenced = snapshots.flatMap(s => s.rolls.flatMap(r => r.photos));
    const inventory = row.legacy === false ? row.uploaded : state.uploaded;
    for (const asset of new Set([...inventory, ...referenced.map(p => p.assetId ?? p.id)])) {
      for (const variant of ["source", "thumb", "full"]) {
        const key = mediaKey(prefix, row, asset, variant);
        const association = { albumId: row.share_id, assetId: asset, photoIds: [...new Set(referenced.filter(p => (p.assetId ?? p.id) === asset).map(p => p.id))] };
        if (entries.has(key)) entries.get(key).associations.push(association);
        else entries.set(key, { key, sourceProvider: "vercel-blob", sourceReference: key, variant, associations: [association], status: "pending" });
      }
    }
  }
  return [...entries.values()];
}
export async function saveJournal(path, journal) {
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(journal, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600); await rename(tmp, path);
}
export async function verifyStateBackup(destination, originalStateBytes, prefix = "roll-for-us") {
  const key = `${prefix}/backups/pre-r2-${sha256(originalStateBytes)}.json`;
  try { await destination.put(key, originalStateBytes, { createOnly: true, contentType: "application/json" }); }
  catch (error) { if (!(error instanceof StorageConflict)) throw error; }
  if (!(await readBytes(await destination.read(key)))?.equals(originalStateBytes)) throw new Error("Exact legacy-state backup could not be verified.");
  return { key, sha256: sha256(originalStateBytes), verifiedAt: new Date().toISOString() };
}
// Destination is read back on every resume. Source reads are never repeated for
// already verified objects; a changed destination stops before touching source.
export async function copyInventory({ source, destination, journal, persist = async () => {}, maxSourceReads = 0, decode }) {
  if (!Number.isSafeInteger(maxSourceReads) || maxSourceReads < 0) throw new Error("Explicit source read budget required.");
  const duplicates = new Map();
  for (const entry of journal.objects) {
    if (!entry.key || entry.key.includes("..") || entry.key.startsWith("/")) throw new Error("Invalid object key in manifest.");
    if (duplicates.has(entry.key)) throw new Error("Duplicate destination object key; inventory must be reconciled first.");
    duplicates.set(entry.key, true);
  }
  let reads = 0;
  for (const entry of journal.objects) {
    let bytes, existing;
    try {
      existing = await destination.read(entry.key);
      if (existing) {
        bytes = await readBytes(existing);
        if (!entry.sha256 || sha256(bytes) !== entry.sha256 || bytes.length !== entry.size
          || entry.contentType && existing.contentType !== entry.contentType) throw new Error("Destination differs from verified inventory; no overwrite performed.");
      } else {
        if (entry.status === "verified") throw new Error("Previously verified destination is missing; explicit repair required.");
        if (reads >= maxSourceReads) throw new Error("Source request budget exhausted; resume with a reviewed budget.");
        reads++;
        const object = await source.read(entry.sourceReference ?? entry.key);
        if (!object) throw new Error("Source object missing; no placeholder substituted.");
        bytes = await readBytes(object);
        const hash = sha256(bytes);
        if (entry.sha256 && entry.sha256 !== hash || entry.size !== undefined && entry.size !== bytes.length) throw new Error("Source integrity differs from inventory.");
        entry.size = bytes.length; entry.sha256 = hash; entry.contentType ??= object.contentType;
        if (!entry.contentType) throw new Error("Source content type must be verified.");
        entry.status = "source-verified"; await persist(journal);
        try { await destination.put(entry.key, bytes, { createOnly: true, contentType: entry.contentType, metadata: { sha256: hash } }); }
        catch (error) { if (!(error instanceof StorageConflict)) throw error; }
        const result = await destination.read(entry.key);
        const verified = await readBytes(result);
        if (!verified || verified.length !== entry.size || sha256(verified) !== hash || result.contentType !== entry.contentType) throw new Error("Destination integrity verification failed.");
      }
      if (decode && ["thumb", "full"].includes(entry.variant)) await decode(bytes);
      entry.status = "verified"; entry.verifiedAt = new Date().toISOString(); delete entry.error;
      await persist(journal);
    } catch (error) {
      entry.error = error.message; await persist(journal);
      // Fail closed for auth, quota, missing or integrity failure. Never retry a
      // blocked Blob store, silently skip a failed item, or delete the source.
      throw error;
    }
  }
  return { verified: journal.objects.length, sourceReads: reads };
}

async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (command === "plan" && input && output) {
    const state = JSON.parse(await readFile(input, "utf8"));
    await saveJournal(output, { version: 1, metadataSha256: contentHash(state), provenance: "requires verification before cutover", objects: requiredMedia(state) });
    console.log("Private migration inventory created. No storage requests made."); return;
  }
  if (command === "copy-local" && input) {
    const journal = JSON.parse(await readFile(input, "utf8"));
    const destination = createR2Storage(r2Config());
    const sharp = (await import("sharp")).default;
    const source = { read: async key => {
      const entry = journal.objects.find(e => (e.sourceReference ?? e.key) === key);
      if (!entry?.localFile) throw new Error("Verified local file mapping required.");
      const bytes = await readFile(entry.localFile);
      return { body: [bytes], size: bytes.length, contentType: entry.contentType };
    } };
    const result = await copyInventory({ source, destination, journal, persist: j => saveJournal(input, j), maxSourceReads: journal.objects.length,
      decode: bytes => sharp(bytes, { limitInputPixels: 50_000_000 }).metadata() });
    console.log(JSON.stringify(result)); return;
  }
  if (command === "initialize" && input && output) {
    if (process.env.STORAGE_WRITE_FREEZE !== "true" || process.env.RECOVERY_VERIFIED !== "true") throw new Error("Verified recovery and controlled write-freeze are required.");
    const originalStateBytes = await readFile(input);
    const state = JSON.parse(originalStateBytes), journal = JSON.parse(await readFile(output, "utf8"));
    if (journal.metadataSha256 !== contentHash(state) || journal.objects.some(e => e.status !== "verified")) throw new Error("State or migration verification is incomplete.");
    const expected = requiredMedia(state);
    if (expected.length !== journal.objects.length || expected.some(e => !journal.objects.some(v => v.key === e.key))) throw new Error("Required media coverage is incomplete.");
    const destination = createR2Storage(r2Config());
    // Recheck target bytes without any source reads before publishing authority.
    await copyInventory({ source: { read() { throw new Error("Source reads forbidden"); } }, destination, journal, maxSourceReads: 0 });
    journal.backup = await verifyStateBackup(destination, originalStateBytes);
    await saveJournal(output, journal);
    await initializeR2State(destination, state);
    const restored = await openR2Album(destination).exportState();
    if (contentHash(restored) !== contentHash(state)) throw new Error("Metadata round-trip mismatch. Keep write freeze enabled.");
    console.log("R2 metadata initialized and round-trip verified. Production provider was not changed."); return;
  }
  throw new Error("Usage: storage-migration.mjs plan <verified-state.json> <private-inventory.json> | copy-local <private-inventory.json> | initialize <verified-state.json> <private-inventory.json>");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
