// Explicit live check: synthetic disposable object only, no album or auth reads.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createR2Storage, r2Config } from "../server/r2-storage.mjs";
import { readBytes, sha256, StorageConflict } from "../server/object-storage.mjs";

const objects = createR2Storage(r2Config());
const key = `_migration-validation/adapter-${randomUUID()}`;
const bytes = Buffer.from("Film for us synthetic storage verification. No personal content.");
await objects.put(key, bytes, { createOnly: true, contentType: "text/plain" });
const first = await objects.read(key);
assert.equal(first.contentType, "text/plain"); assert.equal(sha256(await readBytes(first)), sha256(bytes));
assert.equal((await objects.stat(key)).size, bytes.length);
await assert.rejects(objects.put(key, bytes, { createOnly: true }), StorageConflict);
await objects.put(key, Buffer.from("Updated synthetic fixture"), { ifMatch: first.etag, contentType: "text/plain" });
await assert.rejects(objects.put(key, bytes, { ifMatch: first.etag }), StorageConflict);
await objects.delete(key); // Only this newly created disposable test object.
assert.equal(await objects.read(key), null);
console.log(JSON.stringify({ result: "PASS", checks: ["put", "read", "stat", "create-only", "CAS", "stale-CAS", "delete", "missing"], personalObjectsRead: 0 }));
