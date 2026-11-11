import test from "node:test";
import assert from "node:assert/strict";
import { partialRecoveryState } from "../scripts/prepare-partial-recovery.mjs";
import { contentHash } from "../scripts/storage-migration.mjs";
import { stateFixture, objectFixture } from "./support/object-fixture.mjs";
import { initializeR2State, openR2Album } from "../server/r2-album.mjs";
import { sha256 } from "../server/object-storage.mjs";

test("partial recovery keeps known IDs/metadata and omits unavailable image references", async () => {
  const fixture = stateFixture(), content = JSON.parse(fixture.album.published), album = { ...content, id: fixture.album.share_id };
  const id = fixture.uploaded[0], bytesHash = "a".repeat(64);
  const releaseManifest = { albumId: album.id, contentSha256: contentHash(album), images: ["thumb", "full"].map(variant => ({ photoId: id, variant, sha256: bytesHash })) };
  const inventory = { objects: ["source", "thumb", "full"].map(variant => ({ photoId: id, variant, key: `roll-for-us/media/${id}/${variant}`, sha256: bytesHash, size: 1 })) };
  const state = partialRecoveryState({ album, releaseManifest, inventory, owner: fixture.owner });
  assert.equal(state.album.share_id, album.id); assert.equal(state.uploaded.length, 1); assert.equal(state.recovery.pendingPhotos.length, 2);
  assert.deepEqual(state.recovery.originalPublished, album);
  assert.equal(JSON.parse(state.album.published).rolls[0].photos[0].note, content.rolls[0].photos[0].note);
  const objects = objectFixture(); await initializeR2State(objects, state);
  const publicContent = await openR2Album(objects).published(album.id);
  assert.deepEqual(publicContent.rolls.flatMap(r => r.photos.map(p => p.id)), [id]);
  assert.ok(!JSON.stringify(publicContent).includes(fixture.uploaded[1]));
  assert.ok(!JSON.stringify(publicContent).includes("pendingPhotos"));
  assert.ok(!JSON.stringify(publicContent).includes(fixture.owner.password_hash));
});

test("later verified originals restore pending stable IDs into draft without changing publication", async () => {
  const fixture = stateFixture(), album = { ...JSON.parse(fixture.album.published), id: fixture.album.share_id };
  const allObjects = fixture.uploaded.flatMap(id => ["source", "thumb", "full"].map(variant => {
    const bytes = Buffer.from(`${id}-${variant}`);
    return { photoId: id, variant, key: `roll-for-us/media/${id}/${variant}`, bytes, size: bytes.length, sha256: sha256(bytes), status: "verified" };
  }));
  const releaseManifest = { albumId: album.id, contentSha256: contentHash(album), images: allObjects.filter(o => o.variant !== "source").map(o => ({ photoId: o.photoId, variant: o.variant, sha256: o.sha256 })) };
  const state = partialRecoveryState({ album, releaseManifest, inventory: { objects: allObjects.filter(o => o.photoId === fixture.uploaded[0]) }, owner: fixture.owner });
  const objects = objectFixture(); await initializeR2State(objects, state);
  const store = openR2Album(objects), incoming = allObjects.filter(o => o.photoId !== fixture.uploaded[0]);
  for (const o of incoming) await objects.put(o.key, o.bytes, { contentType: "image/webp" });
  const bad = structuredClone(incoming); bad[0].sha256 = "incorrect";
  await assert.rejects(store.restorePendingPhotos({ albumId: album.id, objects: bad }), { status: 422 });
  const result = await store.restorePendingPhotos({ albumId: album.id, objects: incoming });
  assert.equal(result.restoredToDraft, 2); assert.equal(result.publicationChanged, false);
  assert.equal((await store.published(album.id)).rolls.flatMap(r => r.photos).length, 1);
  const draft = await store.manage(album.id);
  assert.deepEqual(draft.album.rolls.flatMap(r => r.photos.map(p => p.id)), fixture.uploaded);
  assert.equal((await store.exportState()).recovery.pendingPhotos.length, 0);
  await store.publish(draft.revision, album.id);
  assert.equal((await store.published(album.id)).rolls.flatMap(r => r.photos).length, 3);
});
