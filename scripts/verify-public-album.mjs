// Read-only production regression manifest. Stores hashes and public paths, never photos or letter text.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const [mode, path] = process.argv.slice(2);
if (!["snapshot", "compare"].includes(mode) || !path) throw new Error("Usage: node scripts/verify-public-album.mjs snapshot|compare <private-manifest-path>");
const origin = "https://filmforus.space", albumId = "OhqQkmPtTAlxEkHH";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
async function get(path) {
  const response = await fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(30000), cache: "no-store" });
  if (!response.ok) throw new Error(`Production read failed (${response.status}): ${path}`);
  return response;
}
const album = await (await get(`/api/a/${albumId}`)).json();
assert.equal(album.id, albumId);
const photos = album.rolls.flatMap(roll => roll.photos);
const images = [];
for (const photo of photos) {
  for (const variant of ["thumb", "full"]) {
    const url = photo[variant];
    assert.match(url, new RegExp(`^/api/a/${albumId}/media/[a-f0-9-]{36}/${variant}$`));
    const response = await get(url);
    assert.match(response.headers.get("content-type"), /^image\/webp/);
    images.push({ photoId: photo.id, variant, url, sha256: digest(Buffer.from(await response.arrayBuffer())) });
  }
}
const result = { albumId, photos: photos.length, contentSha256: digest(JSON.stringify(canonical(album))), images };
if (mode === "snapshot") await writeFile(path, JSON.stringify(result, null, 2), { mode: 0o600, flag: "wx" });
else assert.deepEqual(result, JSON.parse(await readFile(path, "utf8")), "Production album content, photo IDs, URLs or image bytes changed");
console.log(JSON.stringify({ mode, albumId, photos: photos.length, verifiedImages: images.length, contentSha256: result.contentSha256, result: "PASS" }));
