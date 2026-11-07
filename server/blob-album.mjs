import { BlobNotFoundError, BlobPreconditionFailedError, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import {
  Problem, addDraftPhoto, assertPhoto, assertRevision, initialAlbum, manageAlbum,
  readPublished, saveDraft, validatePublication, withMedia,
} from "./album.mjs";

const privateBlob = { access: "private" };
const stateOptions = { ...privateBlob, contentType: "application/json", cacheControlMaxAge: 60 };
const loginWindow = 15 * 60 * 1000;

export const albumStatePath = (prefix) => `${prefix}/album.json`;
export const photoPath = (prefix, id, variant) => `${prefix}/media/${id}/${variant}`;
export const createState = (album = initialAlbum(), owner = null, uploaded = []) => ({
  album, owner, uploaded, sessions: {}, attempts: {},
});

export function openBlobAlbum(prefix = "roll-for-us") {
  const path = albumStatePath(prefix);
  const manage = (row) => ({ ...manageAlbum(row), directUpload: true });
  const preview = (row) => withMedia(JSON.parse(row.draft), row.share_id, "/api/draft-media");

  async function read() {
    // Compressed responses have a weak ETag that Blob rejects for conditional writes.
    const response = await get(path, {
      ...privateBlob,
      useCache: false,
      headers: { "accept-encoding": "identity" },
    });
    return response && {
      state: await new Response(response.stream).json(),
      etag: response.blob.etag,
    };
  }

  async function snapshot() {
    const existing = await read();
    if (existing) return existing;
    const state = createState();
    try {
      const { etag } = await put(path, JSON.stringify(state), stateOptions);
      return { state, etag };
    } catch (error) {
      const concurrent = await read();
      if (concurrent) return concurrent;
      throw error;
    }
  }

  async function change(update) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { state, etag } = await snapshot();
      const before = JSON.stringify(state);
      const result = update(state);
      const after = JSON.stringify(state);
      if (before === after) return result;
      try {
        await put(path, after, { ...stateOptions, allowOverwrite: true, ifMatch: etag });
        return result;
      } catch (error) {
        if (!(error instanceof BlobPreconditionFailedError)) throw error;
      }
    }
    throw new Problem(503, "The album is busy. Try again in a moment.");
  }

  return {
    async manage() { return manage((await snapshot()).state.album); },
    async preview() { return preview((await snapshot()).state.album); },
    async published(share) { return readPublished((await snapshot()).state.album, share); },
    save(revision, input) {
      return change(({ album }) => {
        const next = saveDraft(album, revision, input);
        if (next !== album.draft) {
          album.draft = next;
          album.revision++;
        }
        return manage(album);
      });
    },
    async hasUpload(id) { return (await snapshot()).state.uploaded.includes(id); },
    async uploadTarget(id, revision, maximumSizeInBytes) {
      const { state } = await snapshot();
      if (state.uploaded.includes(id)) return {};
      assertRevision(state.album, revision);
      const pathname = photoPath(prefix, id, "source");
      try {
        await head(pathname);
        return {};
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) throw error;
      }
      const validUntil = Date.now() + 5 * 60 * 1000;
      const allowedContentTypes = ["application/octet-stream"];
      const token = await issueSignedToken({ pathname, operations: ["put"], validUntil, maximumSizeInBytes, allowedContentTypes });
      const { presignedUrl } = await presignUrl(token, {
        ...privateBlob, operation: "put", pathname, validUntil, maximumSizeInBytes, allowedContentTypes,
        addRandomSuffix: false, allowOverwrite: false,
      });
      return { url: presignedUrl };
    },
    async uploadSource(id, maximumSizeInBytes) {
      const result = await get(photoPath(prefix, id, "source"), { ...privateBlob, useCache: false });
      if (!result) throw new Problem(422, "The upload could not be found. Try again.");
      if (result.blob.size > maximumSizeInBytes) {
        await result.stream.cancel();
        throw new Problem(413, "The file exceeds the size limit.");
      }
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    async addPhoto(revision, roll, id, { thumb, full }) {
      const { state } = await snapshot();
      if (state.uploaded.includes(id)) return manage(state.album);
      assertRevision(state.album, revision);
      // Each ID has an immutable original, so retries render the same two files.
      const options = { ...privateBlob, contentType: "image/webp", allowOverwrite: true };
      await Promise.all([
        put(photoPath(prefix, id, "thumb"), thumb, options),
        put(photoPath(prefix, id, "full"), full, options),
      ]);
      return change(({ album, uploaded }) => {
        if (uploaded.includes(id)) return manage(album);
        album.draft = addDraftPhoto(album, revision, roll, id);
        album.revision++;
        uploaded.push(id);
        return manage(album);
      });
    },
    publish(revision) {
      return change(({ album, uploaded }) => {
        assertRevision(album, revision);
        if (album.published_revision !== revision) {
          validatePublication(album, revision, (id) => uploaded.includes(id));
          album.published_revision = revision;
          album.published = album.draft;
        }
        return manage(album);
      });
    },
    async media(id, variant, share) {
      const { state } = await snapshot();
      assertPhoto(share === undefined ? preview(state.album) : readPublished(state.album, share), id);
      const result = await get(photoPath(prefix, id, variant), privateBlob);
      if (!result) throw new Problem(404, "This photo could not be found.");
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    async localOwner() { return (await snapshot()).state.owner; },
    addSession(hash, expires) {
      return change(({ sessions }) => {
        const now = Date.now();
        for (const [key, time] of Object.entries(sessions)) if (time <= now) delete sessions[key];
        sessions[hash] = expires;
      });
    },
    async sessionValid(hash) { return (await snapshot()).state.sessions[hash] > Date.now(); },
    deleteSession(hash) { return change(({ sessions }) => { delete sessions[hash]; }); },
    recordLoginAttempt(key) {
      return change(({ attempts }) => {
        const now = Date.now();
        for (const [address, entry] of Object.entries(attempts)) if (entry.until <= now) delete attempts[address];
        const entry = attempts[key] ?? { count: 0, until: now + loginWindow };
        if (entry.count >= 8 || Object.keys(attempts).length >= 1000) {
          throw new Problem(429, "Too many attempts. Try again in 15 minutes.");
        }
        attempts[key] = { ...entry, count: entry.count + 1 };
      });
    },
    clearLoginAttempts(key) { return change(({ attempts }) => { delete attempts[key]; }); },
  };
}
