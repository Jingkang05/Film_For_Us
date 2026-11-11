import { initialAlbum, manageAlbum, albumStatus, saveDraft, assertRevision, Problem,
  validatePublication, publicationSnapshot, readPublished, withMedia, assertPhoto, text, validateDraft } from "./album.mjs";

const rows = state => [state.album, ...(state.albums ?? [])].filter(Boolean);
export function validateState(state) {
  try {
    if (!state?.album || !Array.isArray(state.uploaded) || !state.sessions || Array.isArray(state.sessions)
        || !state.attempts || Array.isArray(state.attempts)
        || (state.schemaVersion !== undefined && state.schemaVersion !== 2)
        || (state.albums !== undefined && !Array.isArray(state.albums))) throw new Error();
    const ids = new Set();
    for (const row of rows(state)) {
      if (!/^[A-Za-z0-9_-]{16}$/.test(row.share_id) || ids.has(row.share_id)
          || !Number.isSafeInteger(row.revision) || row.revision < 0
          || (row.status !== undefined && !["draft", "published", "unpublished", "deleted"].includes(row.status))
          || (row.legacy === false && !Array.isArray(row.uploaded))) throw new Error();
      ids.add(row.share_id);
      for (const snapshot of [row.draft, row.published].filter(value => value !== null && value !== undefined)) {
        const content = JSON.parse(snapshot);
        if (content.rolls?.length !== 3) throw new Error();
        validateDraft(content, content);
      }
      if (!row.draft || (row.published_revision !== null && (!Number.isSafeInteger(row.published_revision)
          || row.published_revision > row.revision))) throw new Error();
    }
  } catch { throw new Problem(503, "Stored album data needs review. No changes were made."); }
  return state;
}
export function findAlbum(state, id) {
  const row = id === undefined ? state.album : rows(state).find(row => row.share_id === id);
  if (!row || row.deleted) throw new Problem(404, "This album could not be found.");
  return row;
}
const uploadsFor = (state, row) => row.legacy === false ? row.uploaded : state.uploaded;
const preview = row => withMedia(JSON.parse(row.draft), row.share_id,
  row.legacy === false ? `/api/editor/${row.share_id}/media` : "/api/draft-media");
const touch = row => { row.revision++; row.updatedAt = new Date().toISOString(); };
const aliases = row => row.published ? [JSON.parse(row.published).shareSlug, ...(JSON.parse(row.published).shareAliases ?? [])].filter(Boolean) : [];
function assertUniqueLink(state, row, slug) {
  if (!slug) return;
  if (rows(state).some(other => other !== row && [other.share_id, ...aliases(other), JSON.parse(other.draft).shareSlug].includes(slug))) {
    throw new Problem(409, "This sharing address is already reserved by another album. Choose another suffix.");
  }
  if (slug === row.share_id) throw new Problem(422, "Leave the suffix empty to use this album's ID.");
}
function publicRow(state, share) {
  const row = rows(state).find(row => row.share_id === share || aliases(row).includes(share));
  if (!row || row.deleted || albumStatus(row) !== "published") throw new Problem(404, "This album has not been published yet.");
  return row;
}
export function collectionStore({ snapshot, change, writeMedia, readMedia, directUpload = false, newAlbum = initialAlbum }) {
  const manage = row => ({ ...manageAlbum(row), ...(directUpload ? { directUpload: true } : {}) });
  return {
    async list() {
      return rows((await snapshot()).state).filter(row => !row.deleted).map(row => {
        const album = JSON.parse(row.draft);
        return { id: row.share_id, title: album.title, photoCount: album.rolls.reduce((n, roll) => n + roll.photos.length, 0),
          status: albumStatus(row), revision: row.revision, publishedRevision: row.published_revision,
          shareSlug: row.published ? JSON.parse(row.published).shareSlug ?? "" : "", updatedAt: row.updatedAt };
      });
    },
    create(title = "Untitled album") {
      const row = { ...newAlbum(), legacy: false, status: "draft", uploaded: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const content = JSON.parse(row.draft);
      content.title = text(title, 80);
      row.draft = JSON.stringify(content);
      return change(state => {
        if (rows(state).some(other => other.share_id === row.share_id || aliases(other).includes(row.share_id))) throw new Problem(409, "An album with this ID already exists. Try creating it again.");
        state.schemaVersion = 2;
        (state.albums ??= []).push(structuredClone(row));
        return manage(row);
      });
    },
    async manage(id) { return manage(findAlbum((await snapshot()).state, id)); },
    async preview(id) { return preview(findAlbum((await snapshot()).state, id)); },
    async published(share) { const { state } = await snapshot(); return readPublished(publicRow(state, share), share); },
    save(revision, input, id) {
      return change(state => {
        const row = findAlbum(state, id);
        const next = saveDraft(row, revision, input);
        assertUniqueLink(state, row, JSON.parse(next).shareSlug);
        if (next !== row.draft) { row.draft = next; touch(row); }
        return manage(row);
      });
    },
    async hasUpload(asset, id) {
      const { state } = await snapshot();
      return uploadsFor(state, findAlbum(state, id)).includes(asset);
    },
    recordUploadAttempt(key) {
      return change(state => {
        const now = Date.now();
        const attempts = state.uploadAttempts ??= {};
        for (const [address, entry] of Object.entries(attempts)) if (entry.until <= now) delete attempts[address];
        const entry = attempts[key] ?? { count: 0, until: now + 15 * 60 * 1000 };
        if (entry.count >= 180 || Object.keys(attempts).length >= 1000) throw new Problem(429, "Upload limit reached. Try again in 15 minutes.");
        attempts[key] = { ...entry, count: entry.count + 1 };
      });
    },
    async checkUpload(asset, revision, id, replace) {
      const { state } = await snapshot(), row = findAlbum(state, id);
      if (uploadsFor(state, row).includes(asset)) return row;
      assertRevision(row, revision);
      if (replace) assertPhoto(JSON.parse(row.draft), replace);
      if (row.legacy !== false && rows(state).some(other => other !== row && uploadsFor(state, other).includes(asset))) throw new Problem(409, "Choose the photo again to create a unique upload ID.");
      return row;
    },
    async addPhoto(revision, rollId, asset, files, id, replace) {
      const row = await this.checkUpload(asset, revision, id, replace);
      if (await this.hasUpload(asset, id)) return this.manage(id);
      await writeMedia(row, asset, files);
      return change(state => {
        const row = findAlbum(state, id), uploaded = uploadsFor(state, row);
        if (uploaded.includes(asset)) return manage(row);
        assertRevision(row, revision);
        const content = JSON.parse(row.draft);
        if (replace) {
          assertPhoto(content, replace);
          for (const roll of content.rolls) for (const photo of roll.photos) if (photo.id === replace) photo.assetId = asset;
        } else {
          const roll = content.rolls.find(roll => roll.id === rollId);
          if (!roll) throw new Problem(422, "Choose a destination roll first.");
          if (content.rolls.reduce((n, roll) => n + roll.photos.length, 0) >= 500) throw new Problem(422, "An album can contain up to 500 photos.");
          roll.photos.push({ id: asset, date: "", note: "" });
        }
        row.draft = JSON.stringify(content); touch(row); uploaded.push(asset);
        return manage(row);
      });
    },
    publish(revision, id) {
      return change(state => {
        const row = findAlbum(state, id);
        assertRevision(row, revision);
        if (row.published_revision === revision && albumStatus(row) === "published") return manage(row);
        const content = JSON.parse(row.draft), uploaded = uploadsFor(state, row);
        validatePublication(row, revision, photoId => {
          const photo = content.rolls.flatMap(roll => roll.photos).find(photo => photo.id === photoId);
          return uploaded.includes(photo.assetId ?? photo.id);
        });
        assertUniqueLink(state, row, content.shareSlug);
        row.published = publicationSnapshot(row);
        touch(row); row.published_revision = row.revision; row.status = "published";
        return manage(row);
      });
    },
    unpublish(revision, id) {
      return change(state => {
        const row = findAlbum(state, id); assertRevision(row, revision);
        if (albumStatus(row) !== "published") throw new Problem(422, "Only a published album can be unpublished.");
        row.status = "unpublished"; touch(row);
        return manage(row);
      });
    },
    remove(revision, confirmation, id) {
      return change(state => {
        const row = findAlbum(state, id); assertRevision(row, revision);
        if (confirmation !== row.share_id) throw new Problem(422, "Type the album ID to confirm deletion.");
        // Keep a tombstone and immutable media. Never recycle a published address.
        row.deleted = true; row.status = "deleted"; touch(row);
        return { ok: true };
      });
    },
    async media(photoId, variant, share, id) {
      const { state } = await snapshot();
      const row = share === undefined ? findAlbum(state, id) : publicRow(state, share);
      const content = share === undefined ? preview(row) : readPublished(row, share);
      assertPhoto(content, photoId);
      const stored = JSON.parse(share === undefined ? row.draft : row.published);
      const photo = stored.rolls.flatMap(roll => roll.photos).find(photo => photo.id === photoId);
      return readMedia(row, photo.assetId ?? photo.id, variant);
    },
    async localOwner() { return (await snapshot()).state.owner; },
    addSession(hash, expires) {
      return change(state => {
        for (const [key, until] of Object.entries(state.sessions)) if (until <= Date.now()) delete state.sessions[key];
        state.sessions[hash] = expires;
      });
    },
    async sessionValid(hash) { return (await snapshot()).state.sessions[hash] > Date.now(); },
    deleteSession(hash) { return change(state => { delete state.sessions[hash]; }); },
    recordLoginAttempt(key) {
      return change(state => {
        const now = Date.now();
        for (const [key, entry] of Object.entries(state.attempts)) if (entry.until <= now) delete state.attempts[key];
        const entry = state.attempts[key] ?? { count: 0, until: now + 15 * 60 * 1000 };
        if (entry.count >= 8 || Object.keys(state.attempts).length >= 1000) throw new Problem(429, "Too many attempts. Try again in 15 minutes.");
        state.attempts[key] = { ...entry, count: entry.count + 1 };
      });
    },
    clearLoginAttempts(key) { return change(state => { delete state.attempts[key]; }); },
  };
}
