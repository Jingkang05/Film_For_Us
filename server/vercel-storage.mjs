import * as sdk from "@vercel/blob";
import { StorageConflict, StorageFailure } from "./object-storage.mjs";

// Recovery adapter. No implicit retries; a quota/auth failure stops its caller.
export function createVercelStorage(blob = sdk) {
  async function run(op, work, missing = false) {
    try { return await work(); }
    catch (e) {
      if (e instanceof sdk.BlobPreconditionFailedError) throw new StorageConflict();
      if (missing && e instanceof sdk.BlobNotFoundError) return null;
      throw new StorageFailure(op, e.statusCode, e);
    }
  }
  return {
    provider: "vercel-blob",
    async read(key) { const r = await run("read", () => blob.get(key, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } }), true);
      return r && { body: r.stream, size: r.blob.size, contentType: r.blob.contentType, etag: r.blob.etag }; },
    async put(key, body, { contentType, ifMatch, createOnly = false } = {}) {
      return run("write", () => blob.put(key, body, { access: "private", addRandomSuffix: false, contentType, ifMatch, allowOverwrite: !createOnly }));
    },
    async stat(key) { return run("metadata", () => blob.head(key), true); },
    async delete(key) { return run("delete", () => blob.del(key)); },
    async list({ prefix, cursor, limit = 1000 } = {}) { const r = await run("list", () => blob.list({ prefix, cursor, limit }));
      return { objects: r.blobs.map(b => ({ key: b.pathname, size: b.size, etag: b.etag, contentType: b.contentType, reference: b.url })), cursor: r.hasMore ? r.cursor : undefined }; },
  };
}
