import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { processPhoto } from "../server/index.mjs";
import { sha256 } from "../server/object-storage.mjs";
import { rebuildVerifiedVariants } from "../scripts/rebuild-recovery-variants.mjs";

test("reconstruction uses both production hashes, preserves stable IDs and never maps by filename", async t => {
  const dir = await mkdtemp(join(tmpdir(), "film-rebuild-test-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#119977" } }).jpeg().toBuffer();
  const generated = await processPhoto(source), id = "stable-original-photo-id";
  const manifest = { albumId: "synthetic-album", images: ["thumb", "full"].map(variant => ({ photoId: id, variant, sha256: sha256(generated[variant]) })) };
  const file = join(dir, "unrelated-filename.bin"); await writeFile(file, source);
  const result = await rebuildVerifiedVariants({ files: [file], manifest, directory: join(dir, "recovered") });
  assert.equal(result.objects.length, 3); assert.equal(result.objects[0].photoId, id); assert.equal(result.missingPhotoIds.length, 0);
  const badManifest = structuredClone(manifest); badManifest.images[1].sha256 = "wrong";
  const unmatched = await rebuildVerifiedVariants({ files: [file], manifest: badManifest, directory: join(dir, "unmatched") });
  assert.equal(unmatched.objects.length, 0); assert.equal(unmatched.unresolved.length, 1); assert.equal(unmatched.readyForProduction, false);
});
