import { AsyncLocalStorage } from "node:async_hooks";
import { Problem, albumStatus, assertPhoto, readPublished } from "./album.mjs";
import { collectionStore, findAlbum, validateState } from "./collection.mjs";
import { StorageConflict, immutableCache, readBytes, sha256 } from "./object-storage.mjs";

const jsonType = "application/json";
const rowsOf = state => [state.album, ...(state.albums ?? [])];
const authFields = ["owner", "sessions", "attempts", "uploadAttempts"];
export const r2Paths = (prefix = "roll-for-us") => ({ root: `${prefix}/r2/control.json`, auth: `${prefix}/r2/auth.json`, snapshots: `${prefix}/r2/snapshots/` });
export const mediaKey = (prefix, row, asset, variant) => `${prefix}${row.legacy === false ? `/albums/${row.share_id}` : ""}/media/${asset}/${variant}`;
function splitState(state) {
  validateState(state);
  const auth = Object.fromEntries(authFields.filter(k => state[k] !== undefined).map(k => [k, state[k]]));
  const extra = Object.fromEntries(Object.entries(state).filter(([k]) => ![...authFields, "album", "albums"].includes(k)));
  return { auth, extra, rows: rowsOf(state) };
}
async function createImmutable(objects, paths, value, known = new Set()) {
  const bytes = Buffer.from(JSON.stringify(value)), key = `${paths.snapshots}${sha256(bytes)}.json`;
  if (known.has(key)) return key;
  try { await objects.put(key, bytes, { contentType: jsonType, createOnly: true }); }
  catch (error) {
    if (!(error instanceof StorageConflict)) throw error;
    const stored = await readBytes(await objects.read(key));
    if (!stored?.equals(bytes)) throw new Problem(503, "Stored snapshot integrity check failed.");
  }
  return key;
}
async function makeRoot(objects, paths, state, previous) {
  const { extra, rows } = splitState(state);
  const known = new Set(previous ? [previous.extra, ...previous.rows.map(r => r.key)] : []);
  const descriptors = [];
  for (const row of rows) {
    const published = row.published ? JSON.parse(row.published) : {};
    descriptors.push({ id: row.share_id, status: albumStatus(row), deleted: !!row.deleted,
      aliases: [published.shareSlug, ...(published.shareAliases ?? [])].filter(Boolean), key: await createImmutable(objects, paths, row, known) });
  }
  return { version: 1, albumsPresent: state.albums !== undefined, rows: descriptors, extra: await createImmutable(objects, paths, extra, known) };
}
// Explicit migration/init only. Never called by a request or build.
export async function initializeR2State(objects, state, prefix = "roll-for-us") {
  const paths = r2Paths(prefix), { auth } = splitState(state);
  if (await objects.read(paths.root)) throw new Problem(409, "R2 is already initialized; restore must not overwrite live state.");
  const root = await makeRoot(objects, paths, state);
  const bytes = Buffer.from(JSON.stringify(auth));
  try { await objects.put(paths.auth, bytes, { contentType: jsonType, createOnly: true }); }
  catch (error) {
    if (!(error instanceof StorageConflict)) throw error;
    if (!(await readBytes(await objects.read(paths.auth)))?.equals(bytes)) throw new Problem(409, "R2 authentication state differs; initialization stopped.");
  }
  await objects.put(paths.root, Buffer.from(JSON.stringify(root)), { contentType: jsonType, createOnly: true });
  return { albums: root.rows.length, controlPath: paths.root };
}

export function openR2Album(objects, { prefix = "roll-for-us", fallback, fallbackKeys = [], maxAlbumBytes = 2 * 1024 ** 3 } = {}) {
  const paths = r2Paths(prefix), request = new AsyncLocalStorage();
  const cached = immutableCache(), mediaCache = immutableCache();
  const allowedFallback = new Set(fallbackKeys); // Verified immutable media only; no auth/state fallback.
  async function jsonRead(key) {
    const r = await objects.read(key);
    if (!r) throw new Problem(503, "Stored album data is unavailable. No changes were made.");
    const bytes = await readBytes(r, 8 * 1024 * 1024);
    try { return { value: JSON.parse(bytes), etag: r.etag }; }
    catch { throw new Problem(503, "Stored album data needs review. No changes were made."); }
  }
  async function immutable(key) {
    if (typeof key !== "string" || !key.startsWith(paths.snapshots) || !/\/[a-f0-9]{64}\.json$/.test(key)) throw new Problem(503, "Invalid stored snapshot reference.");
    const bytes = await cached(key, async () => {
      const bytes = await readBytes(await objects.read(key), 8 * 1024 * 1024);
      if (!bytes || `${paths.snapshots}${sha256(bytes)}.json` !== key) throw new Problem(503, "Stored snapshot integrity check failed.");
      return bytes;
    });
    return JSON.parse(bytes);
  }
  async function rootRead(fresh = false) {
    const context = request.getStore();
    if (!fresh && context?.root) return context.root;
    const result = await jsonRead(paths.root), root = result.value;
    if (root.version !== 1 || !Array.isArray(root.rows) || !root.rows.length
      || new Set(root.rows.map(r => r.id)).size !== root.rows.length
      || root.rows.some(r => !/^[A-Za-z0-9_-]{16}$/.test(r.id) || !["draft", "published", "unpublished", "deleted"].includes(r.status))) throw new Problem(503, "Invalid collection control document.");
    if (context) context.root = result;
    return result;
  }
  async function snapshot(fresh = false) {
    const { value: root, etag } = await rootRead(fresh);
    const rows = await Promise.all(root.rows.map(r => immutable(r.key)));
    if (rows.some((row, i) => row.share_id !== root.rows[i].id || albumStatus(row) !== root.rows[i].status)) throw new Problem(503, "Collection snapshot does not match its control document.");
    const state = { ...await immutable(root.extra), album: rows[0], ...(root.albumsPresent || rows.length > 1 ? { albums: rows.slice(1) } : {}), owner: null, sessions: {}, attempts: {} };
    validateState(state);
    return { state, etag, root };
  }
  async function change(update) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { state, etag, root: previous } = await snapshot(true), before = JSON.stringify(state);
      const result = update(state);
      if (before === JSON.stringify(state)) return result;
      validateState(state);
      if (Buffer.byteLength(JSON.stringify(state)) > 8 * 1024 * 1024) throw new Problem(422, "The album library is full.");
      const root = await makeRoot(objects, paths, state, previous);
      try {
        await objects.put(paths.root, Buffer.from(JSON.stringify(root)), { contentType: jsonType, ifMatch: etag });
        if (request.getStore()) request.getStore().root = undefined;
        return result;
      } catch (error) { if (!(error instanceof StorageConflict)) throw error; }
    }
    throw new Problem(503, "The album is busy. Try again in a moment.");
  }
  async function authRead() {
    const result = await jsonRead(paths.auth), a = result.value;
    if (!a || typeof a.sessions !== "object" || Array.isArray(a.sessions) || !a.sessions || typeof a.attempts !== "object" || !a.attempts) throw new Problem(503, "Stored administrator data needs review.");
    if (a.owner !== null && (!/^[a-f0-9]{32}$/.test(a.owner?.salt ?? "") || !/^[a-f0-9]{128}$/.test(a.owner?.password_hash ?? ""))) throw new Problem(503, "Stored administrator protection is invalid.");
    return result;
  }
  const authStore = collectionStore({ snapshot: async () => ({ state: (await authRead()).value }), change: async update => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { value, etag } = await authRead(), before = JSON.stringify(value), result = update(value), after = JSON.stringify(value);
      if (before === after) return result;
      if (Buffer.byteLength(after) > 2 * 1024 * 1024) throw new Problem(503, "Administrator state is full.");
      try { await objects.put(paths.auth, Buffer.from(after), { contentType: jsonType, ifMatch: etag }); return result; }
      catch (error) { if (!(error instanceof StorageConflict)) throw error; }
    }
    throw new Problem(503, "The album is busy. Try again in a moment.");
  } });
  async function putMedia(key, bytes) {
    try { await objects.put(key, bytes, { contentType: "image/webp", createOnly: true, metadata: { sha256: sha256(bytes) } }); }
    catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      if (!(await readBytes(await objects.read(key)))?.equals(bytes)) throw new Problem(409, "This upload ID already contains another photo.");
    }
  }
  async function mediaRead(row, asset, variant) {
    const key = mediaKey(prefix, row, asset, variant);
    const bytes = await mediaCache(key, async () => {
      let object = await objects.read(key);
      if (!object && fallback && allowedFallback.has(key)) object = await fallback.read(key);
      return readBytes(object, 4 * 1024 * 1024);
    });
    if (!bytes) throw new Problem(404, "This photo could not be found.");
    return bytes;
  }
  const store = collectionStore({ snapshot, change, directUpload: true, readMedia: mediaRead, storageLimitBytes: maxAlbumBytes,
    writeMedia: async (row, id, { source, thumb, full }) => {
      // Conservative lifetime cap: replacing/deleting photographs never resets accounted bytes.
      const total = (row.storageBytes ?? 0) + (source?.length ?? 0) + thumb.length + full.length;
      if (total > maxAlbumBytes) throw new Problem(422, "This album has reached its storage limit.");
      await putMedia(mediaKey(prefix, row, id, "thumb"), thumb);
      await putMedia(mediaKey(prefix, row, id, "full"), full);
    } });
  async function selectedRow(share, id) {
    const { value: root } = await rootRead();
    const descriptor = share === undefined ? (id === undefined ? root.rows[0] : root.rows.find(r => r.id === id))
      : root.rows.find(r => r.id === share || r.aliases?.includes(share));
    if (!descriptor || descriptor.deleted || (share !== undefined && descriptor.status !== "published")) throw new Problem(404, "This album has not been published yet.");
    const row = await immutable(descriptor.key);
    if (row.share_id !== descriptor.id || albumStatus(row) !== descriptor.status) throw new Problem(503, "Invalid album control reference.");
    return row;
  }
  return {
    ...store,
    runRequest: work => request.run({}, work),
    localOwner: authStore.localOwner, sessionValid: authStore.sessionValid, addSession: authStore.addSession,
    deleteSession: authStore.deleteSession, recordLoginAttempt: authStore.recordLoginAttempt,
    clearLoginAttempts: authStore.clearLoginAttempts, recordUploadAttempt: authStore.recordUploadAttempt,
    async ownerAuthorized(tokenHash, environmentPassword) {
      const { value } = await authRead();
      return !!(environmentPassword || value.owner) && value.sessions[tokenHash] > Date.now();
    },
    async published(share) { return readPublished(await selectedRow(share), share); },
    async media(id, variant, share, albumId, ifNoneMatch) {
      if (!["thumb", "full"].includes(variant)) throw new Problem(404, "This photo could not be found.");
      const row = await selectedRow(share, albumId), content = JSON.parse(share === undefined ? row.draft : row.published);
      if (share !== undefined) readPublished(row, share); // Alias membership is validated against the authoritative snapshot too.
      assertPhoto(content, id);
      const photo = content.rolls.flatMap(r => r.photos).find(p => p.id === id), asset = photo.assetId ?? photo.id;
      const etag = `"${sha256(`${row.share_id}:${row.published_revision}:${share === undefined ? row.revision : "published"}:${asset}:${variant}`)}"`;
      const matches = ifNoneMatch?.split(",").map(s => s.trim().replace(/^W\//, "")).includes(etag);
      if (matches) return { status: 304, etag };
      return { status: 200, etag, bytes: await mediaRead(row, asset, variant) };
    },
    async uploadTarget(asset, revision, maximumSizeInBytes, albumId, replace) {
      const row = await store.checkUpload(asset, revision, albumId, replace);
      const { state } = await snapshot();
      const actual = findAlbum(state, albumId);
      if ((actual.legacy === false ? actual.uploaded : state.uploaded).includes(asset)) return {};
      return objects.signUpload(mediaKey(prefix, row, asset, "source"), { expiresIn: 120, maximumSizeInBytes });
    },
    async uploadSource(asset, maximumSizeInBytes, albumId) {
      const { state } = await snapshot(), row = findAlbum(state, albumId);
      const r = await objects.read(mediaKey(prefix, row, asset, "source"));
      if (!r) throw new Problem(422, "The upload could not be found. Try again.");
      if (r.size > maximumSizeInBytes) { r.body?.destroy?.(); await r.body?.cancel?.(); throw new Problem(413, "The file exceeds the size limit."); }
      return readBytes(r, maximumSizeInBytes);
    },
    async exportState() { const { state } = await snapshot(true); return { ...state, ...(await authRead()).value }; },
    // Operator recovery tool only; deliberately not exposed as an HTTP route.
    // Verified media enters the draft; the existing editor Publish action is
    // still required before it becomes public.
    async restorePendingPhotos(manifest) {
      const { state } = await snapshot(true), recovery = state.recovery;
      if (!recovery?.pendingPhotos || manifest.albumId !== state.album.share_id) throw new Problem(422, "Recovery manifest does not match this album.");
      const photoIds = [...new Set(manifest.objects.map(o => o.photoId))], accepted = [];
      for (const id of photoIds) {
        const pending = recovery.pendingPhotos.find(p => p.photo.id === id);
        if (!pending) { if (state.uploaded.includes(id)) continue; throw new Problem(422, "Photo is not pending recovery."); }
        let size = 0;
        for (const variant of ["source", "thumb", "full"]) {
          const entries = manifest.objects.filter(o => o.photoId === id && o.variant === variant), expected = mediaKey(prefix, state.album, id, variant);
          if (entries.length !== 1 || entries[0].key !== expected || entries[0].status !== "verified") throw new Problem(422, "Recovery media has not been verified.");
          const entry = entries[0], bytes = await readBytes(await objects.read(expected));
          if (!bytes || sha256(bytes) !== entry.sha256 || bytes.length !== entry.size) throw new Problem(422, "Recovery object integrity failed.");
          if (variant !== "source" && !recovery.variantManifest.images.some(r => r.photoId === id && r.variant === variant && r.sha256 === entry.sha256)) throw new Problem(422, "Recovered image does not match historical production.");
          size += bytes.length;
        }
        accepted.push({ pending, size });
      }
      return change(current => {
        if (current.album.revision !== state.album.revision) throw new Problem(409, "The draft changed. Review and retry recovery.");
        const draft = JSON.parse(current.album.draft);
        for (const { pending, size } of accepted) {
          const roll = draft.rolls.find(r => r.id === pending.rollId);
          if (!roll || draft.rolls.some(r => r.photos.some(p => p.id === pending.photo.id))) throw new Problem(409, "Recovered photo conflicts with the current draft.");
          if ((current.album.storageBytes ?? 0) + size > maxAlbumBytes) throw new Problem(422, "This album has reached its storage limit.");
          roll.photos.push(structuredClone(pending.photo)); current.uploaded.push(pending.photo.id);
          current.album.storageBytes = (current.album.storageBytes ?? 0) + size;
        }
        if (accepted.length) {
          current.album.draft = JSON.stringify(draft); current.album.revision++; current.album.updatedAt = new Date().toISOString();
          const restored = new Set(accepted.map(a => a.pending.photo.id));
          current.recovery.pendingPhotos = current.recovery.pendingPhotos.filter(p => !restored.has(p.photo.id));
        }
        return { restoredToDraft: accepted.length, pending: current.recovery.pendingPhotos.length, publicationChanged: false };
      });
    },
    async verifyExisting(id) { const { state } = await snapshot(true); const row = findAlbum(state, id); const auth = (await authRead()).value;
      if (!row.published || !(auth.owner || process.env.OWNER_PASSWORD?.length >= 12)) throw new Problem(503, "Production album protection is not configured.");
      return { albumId: id, publishedPhotos: JSON.parse(row.published).rolls.reduce((n, r) => n + r.photos.length, 0), deepAudit: false }; },
  };
}
