import { createHash } from "node:crypto";
import { BlobNotFoundError, BlobPreconditionFailedError, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { Problem, initialAlbum } from "./album.mjs";
import { collectionStore, findAlbum, validateState } from "./collection.mjs";

const privateBlob = { access: "private" };
const stateOptions = { ...privateBlob, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 };
export const albumStatePath = prefix => `${prefix}/album.json`;
export const photoPath = (prefix, id, variant) => `${prefix}/media/${id}/${variant}`;
export const createState = (album = initialAlbum(), owner = null, uploaded = []) => ({ album, owner, uploaded, sessions: {}, attempts: {} });
const mediaPrefix = (prefix, row) => row.legacy === false ? `${prefix}/albums/${row.share_id}` : prefix;

// Dependency injection exercises real conditional-write behavior without production credentials.
export function openBlobAlbum(prefix = "roll-for-us", blob = { get, head, put, issueSignedToken, presignUrl }) {
  const path = albumStatePath(prefix);
  async function read(target = path) {
    const response = await blob.get(target, { ...privateBlob, useCache: false, headers: { "accept-encoding": "identity" } });
    if (!response) return null;
    const raw = await new Response(response.stream).text();
    return { state: JSON.parse(raw), raw, etag: response.blob.etag };
  }
  async function snapshot() {
    const existing = await read();
    if (existing) {
      validateState(existing.state);
      return existing;
    }
    const state = createState();
    try {
      const raw = JSON.stringify(state);
      const { etag } = await blob.put(path, raw, stateOptions);
      return { state, raw, etag };
    } catch (error) {
      const concurrent = await read();
      if (concurrent) return concurrent;
      throw error;
    }
  }
  async function backup(raw) {
    const checksum = createHash("sha256").update(raw).digest("hex");
    const target = `${prefix}/backups/pre-phase-3-${checksum}.json`;
    let copy = await read(target);
    if (!copy) {
      try { await blob.put(target, raw, stateOptions); }
      catch (error) { if (!await read(target)) throw error; }
      copy = await read(target);
    }
    if (!copy || copy.raw !== raw) throw new Problem(503, "The album backup could not be verified. No changes were made.");
    return target;
  }
  async function change(update) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { state, etag, raw } = await snapshot();
      const before = JSON.stringify(state);
      const result = update(state);
      if (before === JSON.stringify(state)) return result;
      if (state.schemaVersion === undefined || !state.phase3Backup) {
        state.phase3Backup = await backup(raw);
        state.schemaVersion = 2;
      }
      const after = JSON.stringify(state);
      if (Buffer.byteLength(after) > 8 * 1024 * 1024) throw new Problem(422, "The album library is full. Contact the administrator before adding more content.");
      try {
        await blob.put(path, after, { ...stateOptions, allowOverwrite: true, ifMatch: etag });
        return result;
      } catch (error) {
        if (!(error instanceof BlobPreconditionFailedError)) throw error;
      }
    }
    throw new Problem(503, "The album is busy. Try again in a moment.");
  }
  const store = collectionStore({ snapshot, change, directUpload: true,
    async writeMedia(row, id, { thumb, full }) {
      // Immutable optimized variants. Retries reuse successful files rather than overwriting them.
      for (const [variant, bytes] of [["thumb", thumb], ["full", full]]) {
        const target = photoPath(mediaPrefix(prefix, row), id, variant);
        try { await blob.put(target, bytes, { ...privateBlob, addRandomSuffix: false, contentType: "image/webp" }); }
        catch (error) {
          const existing = await blob.get(target, { ...privateBlob, useCache: false });
          if (!existing) throw error;
          if (!Buffer.from(await new Response(existing.stream).arrayBuffer()).equals(bytes)) throw new Problem(409, "This upload ID already contains another photo. Choose the photo again.");
        }
      }
    },
    async readMedia(row, id, variant) {
      const result = await blob.get(photoPath(mediaPrefix(prefix, row), id, variant), privateBlob);
      if (!result) throw new Problem(404, "This photo could not be found.");
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
  });
  return {
    ...store,
    async verifyExisting(expectedId, { deep = false } = {}) {
      const current = await read();
      if (!current || current.state.album?.share_id !== expectedId) throw new Error("Production album identity verification failed.");
      const { state, raw } = current;
      validateState(state);
      if (!state.album.published || !Number.isSafeInteger(state.album.revision)) throw new Error("Production album snapshot verification failed.");
      if (!(process.env.OWNER_PASSWORD?.length >= 12) && (!/^[a-f0-9]{128}$/.test(state.owner?.password_hash ?? "") || !/^[a-f0-9]{32}$/.test(state.owner?.salt ?? ""))) {
        throw new Error("Production administrator protection is not configured.");
      }
      const backupPath = deep ? await backup(raw) : undefined;
      const content = JSON.parse(state.album.published);
      const draft = JSON.parse(state.album.draft);
      const assets = [...new Set([...content.rolls, ...draft.rolls].flatMap(roll => roll.photos.map(photo => photo.assetId ?? photo.id)))];
      for (const asset of assets) {
        if (!state.uploaded.includes(asset)) throw new Error("Production photo reference verification failed.");
        if (deep) await Promise.all(["source", "thumb", "full"].map(variant => blob.head(photoPath(prefix, asset, variant))));
      }
      return { albumId: expectedId, publishedPhotos: content.rolls.reduce((n, roll) => n + roll.photos.length, 0),
        verifiedAssets: deep ? assets.length : 0, referencedAssets: assets.length, deepAudit: deep, backupPath, sha256: createHash("sha256").update(raw).digest("hex") };
    },
    async uploadTarget(id, revision, maximumSizeInBytes, albumId, replace) {
      const row = await store.checkUpload(id, revision, albumId, replace);
      if (await store.hasUpload(id, albumId)) return {};
      const pathname = photoPath(mediaPrefix(prefix, row), id, "source");
      try { await blob.head(pathname); return {}; }
      catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
      const validUntil = Date.now() + 5 * 60 * 1000;
      const allowedContentTypes = ["application/octet-stream"];
      const token = await blob.issueSignedToken({ pathname, operations: ["put"], validUntil, maximumSizeInBytes, allowedContentTypes });
      const { presignedUrl } = await blob.presignUrl(token, {
        ...privateBlob, operation: "put", pathname, validUntil, maximumSizeInBytes, allowedContentTypes,
        addRandomSuffix: false, allowOverwrite: false,
      });
      return { url: presignedUrl };
    },
    async uploadSource(id, maximumSizeInBytes, albumId) {
      const row = findAlbum((await snapshot()).state, albumId);
      const result = await blob.get(photoPath(mediaPrefix(prefix, row), id, "source"), { ...privateBlob, useCache: false });
      if (!result) throw new Problem(422, "The upload could not be found. Try again.");
      if (result.blob.size > maximumSizeInBytes) { await result.stream.cancel(); throw new Problem(413, "The file exceeds the size limit."); }
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
  };
}
