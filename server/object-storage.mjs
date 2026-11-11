import { createHash } from "node:crypto";

export class StorageConflict extends Error { constructor() { super("Object changed concurrently."); this.name = "StorageConflict"; } }
export class StorageFailure extends Error {
  // SDK errors may contain signed URLs/headers; never retain them as Error.cause
  // because ordinary console.error would print those credentials.
  constructor(operation, status, providerCode) {
    const safeCode = ["AccessDenied", "SignatureDoesNotMatch", "InvalidAccessKeyId", "InvalidToken", "ExpiredToken", "NoSuchBucket", "Forbidden", "SlowDown", "InternalError"].includes(providerCode) ? providerCode : undefined;
    super(`Storage ${operation} failed${status ? ` (${status}${safeCode ? `; ${safeCode}` : ""})` : ""}.`);
    this.name = "StorageFailure"; this.status = status; this.providerCode = safeCode;
  }
}
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export async function readBytes(object, limit = 32 * 1024 * 1024) {
  if (!object) return null;
  const stream = object.body;
  if (object.size > limit) { await stream?.cancel?.(); stream?.destroy?.(); throw new StorageFailure("read: object too large"); }
  const chunks = []; let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > limit) throw new StorageFailure("read: object too large");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, size);
  } catch (error) { await stream?.cancel?.().catch(() => {}); stream?.destroy?.(); throw error; }
}

// A cache of immutable bytes only. Never use for authority or authentication.
export function immutableCache(maxBytes = 32 * 1024 * 1024, maxEntries = 128) {
  const values = new Map(), pending = new Map(); let size = 0;
  return async (key, load) => {
    if (values.has(key)) { const v = values.get(key); values.delete(key); values.set(key, v); return v; }
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const bytes = await load();
      if (bytes && bytes.length <= maxBytes) {
        while (values.size && (size + bytes.length > maxBytes || values.size >= maxEntries)) {
          const oldest = values.keys().next().value; size -= values.get(oldest).length; values.delete(oldest);
        }
        values.set(key, bytes); size += bytes.length;
      }
      return bytes;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}
