import test from "node:test";
import assert from "node:assert/strict";
import { copyInventory, requiredMedia, verifyStateBackup } from "../scripts/storage-migration.mjs";
import { objectFixture, stateFixture } from "./support/object-fixture.mjs";
import { StorageFailure, sha256 } from "../server/object-storage.mjs";

test("legacy-state backup verifies exact original bytes and refuses corrupt readback", async () => {
  const destination = objectFixture(), raw = Buffer.from('{ "original": "spacing preserved" }\n');
  const backup = await verifyStateBackup(destination, raw);
  assert.deepEqual(destination.files.get(backup.key).bytes, raw);
  assert.equal((await verifyStateBackup(destination, raw)).sha256, sha256(raw));
  await destination.put(backup.key, Buffer.from("corrupt"));
  await assert.rejects(verifyStateBackup(destination, raw), /backup/);
});

test("inventory preserves album, asset and stable photo IDs including replacement", () => {
  const state = stateFixture();
  const content = JSON.parse(state.album.draft); content.rolls[0].photos[0].assetId = "replacement";
  state.album.draft = JSON.stringify(content); state.uploaded.push("replacement");
  const inventory = requiredMedia(state);
  assert.equal(inventory.length, 12);
  const replaced = inventory.find(r => r.key.endsWith("replacement/full"));
  assert.equal(replaced.associations[0].photoIds[0], state.uploaded[0]);
});
test("copy verifies bytes/type/size; resume skips source and handles interruption", async () => {
  const source = objectFixture(), destination = objectFixture();
  for (const key of ["a", "b"]) await source.put(key, Buffer.from(key), { contentType: "text/plain" });
  const journal = { objects: ["a", "b"].map(key => ({ key, variant: "source" })) };
  await assert.rejects(copyInventory({ source, destination, journal, maxSourceReads: 1 }), /budget/);
  assert.equal(journal.objects[0].status, "verified");
  source.calls.length = 0;
  assert.equal((await copyInventory({ source, destination, journal, maxSourceReads: 1 })).sourceReads, 1);
  assert.equal(source.calls.filter(c => c.op === "read").length, 1);
  source.calls.length = 0;
  await copyInventory({ source, destination, journal, maxSourceReads: 0 }); assert.equal(source.calls.length, 0);
  assert.equal(journal.objects[1].sha256, sha256("b"));
  await destination.put("a", Buffer.from("corrupt"), { contentType: "text/plain" });
  await assert.rejects(copyInventory({ source, destination, journal, maxSourceReads: 0 }), /differs/);
  assert.equal(source.calls.length, 0);
});
test("copy stops on blocked/missing source, duplicate keys and corrupt destination readback", async () => {
  const source = objectFixture(), destination = objectFixture();
  source.fail(new StorageFailure("read", 403));
  await assert.rejects(copyInventory({ source, destination, journal: { objects: [{ key: "a" }, { key: "b" }] }, maxSourceReads: 2 }), StorageFailure);
  assert.equal(source.calls.length, 1); source.fail(undefined);
  await assert.rejects(copyInventory({ source, destination, journal: { objects: [{ key: "a" }] }, maxSourceReads: 1 }), /missing/);
  await assert.rejects(copyInventory({ source, destination, journal: { objects: [{ key: "a" }, { key: "a" }] }, maxSourceReads: 1 }), /Duplicate/);
  await source.put("a", Buffer.from("correct"), { contentType: "text/plain" });
  const originalPut = destination.put;
  destination.put = (key, bytes, options) => originalPut(key, Buffer.from("corrupt"), options);
  await assert.rejects(copyInventory({ source, destination, journal: { objects: [{ key: "a" }] }, maxSourceReads: 1 }), /integrity/);
});
