import test from "node:test";
import assert from "node:assert/strict";
import { createR2Storage, r2Config } from "../server/r2-storage.mjs";
import { createVercelStorage } from "../server/vercel-storage.mjs";
import { StorageConflict, StorageFailure, readBytes } from "../server/object-storage.mjs";
import { openStorage } from "../server/storage.mjs";

test("R2 adapter uses conditional S3 operations, normalizes failures, and supports inventory/deletion", async () => {
  const commands = []; let response = {}, error;
  const client = { send: async c => { commands.push(c); if (error) throw error; return response; } };
  const store = createR2Storage({ bucket: "synthetic", client });
  response = { ETag: '"v1"' };
  assert.deepEqual(await store.put("key", Buffer.from("x"), { createOnly: true, contentType: "text/plain" }), { etag: '"v1"' });
  assert.equal(commands.at(-1).input.IfNoneMatch, "*");
  await store.put("key", Buffer.from("y"), { ifMatch: '"v1"' }); assert.equal(commands.at(-1).input.IfMatch, '"v1"');
  await assert.rejects(store.put("key", "z", { ifMatch: "x", createOnly: true }));
  response = { Body: [Buffer.from("hello")], ContentLength: 5, ContentType: "text/plain", ETag: '"v2"' };
  const object = await store.read("key"); assert.equal((await readBytes(object)).toString(), "hello");
  assert.equal((await store.stat("key")).size, 5);
  response = { Contents: [{ Key: "key", Size: 5, ETag: '"v2"' }], NextContinuationToken: "next" };
  assert.equal((await store.list({ prefix: "k", cursor: "before" })).cursor, "next");
  await store.delete("key"); assert.equal(commands.at(-1).constructor.name, "DeleteObjectCommand");
  error = { $metadata: { httpStatusCode: 404 } }; assert.equal(await store.read("absent"), null); assert.equal(await store.stat("absent"), null);
  error = { $metadata: { httpStatusCode: 412 } }; await assert.rejects(store.put("key", "x"), StorageConflict);
  for (const status of [403, 429, 500]) {
    error = { $metadata: { httpStatusCode: status }, message: "must not leak signed-url-secret" };
    await assert.rejects(store.read("key"), e => e instanceof StorageFailure && e.status === status && !e.message.includes("secret"));
  }
  error = { name: "AccessDenied", $metadata: { httpStatusCode: 403 }, message: "signed-url-secret" };
  await assert.rejects(store.read("key"), e => e.providerCode === "AccessDenied" && !e.cause && !e.message.includes("secret"));
  error = { name: "signed-url-secret", $metadata: { httpStatusCode: 403 } };
  await assert.rejects(store.read("key"), e => e.providerCode === undefined && !e.message.includes("secret"));
});
test("presigned R2 uploads are short lived, create-only and require signed headers", async () => {
  const store = createR2Storage({ bucket: "synthetic-bucket", endpoint: "https://synthetic.r2.cloudflarestorage.com", region: "auto",
    credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" } });
  const target = await store.signUpload("source/key", { expiresIn: 120 });
  const url = new URL(target.url);
  assert.equal(url.protocol, "https:"); assert.equal(url.searchParams.get("X-Amz-Expires"), "120");
  assert.ok(url.searchParams.get("X-Amz-SignedHeaders").includes("if-none-match"));
  assert.equal(target.headers["If-None-Match"], "*");
  await assert.rejects(store.signUpload("key", { expiresIn: 301 }));
});
test("configuration rejects missing/insecure endpoints and production preview reuse", () => {
  assert.throws(() => r2Config({}), /Missing/);
  const env = { R2_ENDPOINT: "https://synthetic.r2.cloudflarestorage.com", R2_BUCKET: "synthetic-bucket", R2_ACCESS_KEY_ID: "x", R2_SECRET_ACCESS_KEY: "y" };
  assert.equal(r2Config(env).region, "auto");
  assert.equal(r2Config({ ...env, R2_SESSION_TOKEN: "synthetic-temporary-token" }).credentials.sessionToken, "synthetic-temporary-token");
  for (const endpoint of ["http://synthetic.r2.cloudflarestorage.com", "https://unrelated.invalid", "https://x.r2.cloudflarestorage.com/path"]) assert.throws(() => r2Config({ ...env, R2_ENDPOINT: endpoint }));
  assert.throws(() => r2Config({ ...env, VERCEL_ENV: "preview", R2_PRODUCTION_BUCKET: env.R2_BUCKET }));
  assert.throws(() => r2Config({ ...env, VERCEL_ENV: "production", R2_ENVIRONMENT: "preview" }));
  assert.equal(r2Config({ ...env, VERCEL_ENV: "preview", R2_ENVIRONMENT: "preview" }).bucket, env.R2_BUCKET);
  assert.throws(() => openStorage({ VERCEL_ENV: "preview" }), /isolated/);
  assert.throws(() => openStorage({ STORAGE_PROVIDER: "unknown" }), /Unsupported/);
});
test("Blob recovery adapter does not retry a blocked source", async () => {
  let calls = 0;
  const store = createVercelStorage({ get: async () => { calls++; throw new Error("403 forbidden"); } });
  await assert.rejects(store.read("state"), StorageFailure); assert.equal(calls, 1);
});
