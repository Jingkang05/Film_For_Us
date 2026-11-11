import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Problem extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const draftInitial = {
  title: "Film for us",
  letter: "",
  rolls: ["#cfad77", "#b84a32", "#555e43"].map((color, index) => ({
    id: `roll-${index + 1}`, name: "", color, photos: [],
  })),
};

function text(value, limit) {
  if (typeof value !== "string" || value.length > limit) throw new Problem(422, "Check the text length and try again.");
  return value.trim();
}

export function validateShareSlug(value) {
  if (typeof value !== "string") throw new Problem(422, "Use up to 80 English letters, numbers, hyphens or underscores for the URL suffix.");
  const slug = value.normalize("NFKC").trim().toLowerCase();
  if (slug.length > 80 || (slug && !/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(slug))) {
    throw new Problem(422, "Use up to 80 English letters, numbers, hyphens or underscores for the URL suffix.");
  }
  return slug;
}

// Keep every previously published address valid, including when the suffix is cleared.
export function publicationSnapshot(row) {
  const next = JSON.parse(row.draft);
  const previous = row.published ? JSON.parse(row.published) : {};
  const aliases = new Set(previous.shareAliases ?? []);
  if (previous.shareSlug) aliases.add(previous.shareSlug);
  if (next.shareSlug) aliases.add(next.shareSlug);
  return JSON.stringify({ ...next, shareAliases: [...aliases] });
}

function validateDraft(input, previous) {
  if (!input || !Array.isArray(input.rolls) || input.rolls.length !== previous.rolls.length) {
    throw new Problem(422, "The album needs three film rolls.");
  }
  const available = new Set(previous.rolls.flatMap((roll) => roll.photos.map(({ id }) => id)));
  return {
    title: text(input.title, 80),
    shareSlug: validateShareSlug(input.shareSlug ?? previous.shareSlug ?? ""),
    letter: text(input.letter, 2000),
    rolls: previous.rolls.map((existing, index) => {
      const roll = input.rolls[index];
      if (roll?.id !== existing.id || typeof roll.color !== "string"
          || !/^#[0-9a-f]{6}$/i.test(roll.color) || !Array.isArray(roll.photos)) {
        throw new Problem(422, "Check the roll settings and try again.");
      }
      return {
        id: existing.id,
        name: text(roll.name, 40),
        color: roll.color.toLowerCase(),
        photos: roll.photos.map((photo) => {
          if (!available.delete(photo?.id)) throw new Problem(422, "A photo is missing or appears more than once.");
          const date = text(photo.date, 10);
          if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
              || new Date(date).toISOString().slice(0, 10) !== date)) {
            throw new Problem(422, "Enter a valid date for the photo.");
          }
          return { id: photo.id, date, note: text(photo.note ?? "", 600) };
        }),
      };
    }),
  };
}

export function withMedia(album, id, base) {
  const { shareAliases, ...content } = album;
  return {
    ...content, id,
    rolls: album.rolls.map((roll) => ({
      ...roll,
      photos: roll.photos.map((photo) => ({
        ...photo, note: photo.note ?? "", thumb: `${base}/${photo.id}/thumb`, full: `${base}/${photo.id}/full`,
      })),
    })),
  };
}

export function initialAlbum() {
  return {
    share_id: randomBytes(12).toString("base64url"), revision: 0,
    draft: JSON.stringify(draftInitial), published_revision: null, published: null,
  };
}

export function assertRevision(row, revision) {
  if (row.revision !== revision) throw new Problem(409, "The draft changed in another tab. Reload and review the latest version before editing.");
}

export function manageAlbum(row) {
  return {
    album: withMedia(JSON.parse(row.draft), row.share_id, "/api/draft-media"),
    revision: row.revision,
    publishedRevision: row.published_revision,
    shareId: row.share_id,
    shareSlug: row.published ? JSON.parse(row.published).shareSlug ?? "" : "",
  };
}

export function saveDraft(row, revision, input) {
  assertRevision(row, revision);
  return JSON.stringify(validateDraft(input, JSON.parse(row.draft)));
}

export function addDraftPhoto(row, revision, rollId, id) {
  assertRevision(row, revision);
  const next = JSON.parse(row.draft);
  const roll = next.rolls.find((item) => item.id === rollId);
  if (!roll) throw new Problem(422, "Choose a destination roll first.");
  roll.photos.push({ id, date: "", note: "" });
  return JSON.stringify(next);
}

export function validatePublication(row, revision, hasUpload) {
  assertRevision(row, revision);
  const next = JSON.parse(row.draft);
  if (!next.title || !next.letter || next.rolls.some((roll) => !roll.name || !roll.photos.length)) {
    throw new Problem(422, "Add a title and opening letter, name all three rolls, and add at least one photo to each roll.");
  }
  const photos = next.rolls.flatMap((roll) => roll.photos);
  if (photos.some((photo) => !photo.date)) {
    throw new Problem(422, "Add a date to each photo before publishing.");
  }
  if (photos.some((photo) => !hasUpload(photo.id))) {
    throw new Problem(422, "Wait for each photo to finish uploading before publishing.");
  }
}

export function readPublished(row, shareId) {
  const album = row.published ? JSON.parse(row.published) : null;
  if (!album || (row.share_id !== shareId && album.shareSlug !== shareId && !(album.shareAliases ?? []).includes(shareId))) {
    throw new Problem(404, "This album has not been published yet.");
  }
  return withMedia(album, row.share_id, `/api/a/${row.share_id}/media`);
}

export function assertPhoto(album, id) {
  if (!album.rolls.some((roll) => roll.photos.some((photo) => photo.id === id))) {
    throw new Problem(404, "This photo could not be found.");
  }
}

export function openAlbum(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS album (
      id INTEGER PRIMARY KEY CHECK (id = 1), share_id TEXT NOT NULL,
      revision INTEGER NOT NULL, draft TEXT NOT NULL,
      published_revision INTEGER, published TEXT
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, source BLOB NOT NULL, thumb BLOB NOT NULL, full BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_owner (
      id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
  `);
  const initial = initialAlbum();
  db.prepare("INSERT OR IGNORE INTO album (id, share_id, revision, draft) VALUES (1, ?, 0, ?)")
    .run(initial.share_id, initial.draft);

  const get = () => db.prepare("SELECT * FROM album WHERE id = 1").get();
  const draft = (row) => JSON.parse(row.draft);

  function transaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work(get());
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function manage(row = get()) {
    return manageAlbum(row);
  }

  return {
    manage,
    save(revision, input) {
      return transaction((row) => {
        const next = saveDraft(row, revision, input);
        if (next !== row.draft) {
          db.prepare("UPDATE album SET draft = ?, revision = revision + 1 WHERE id = 1").run(next);
        }
        return manage();
      });
    },
    hasUpload(id) {
      return Boolean(db.prepare("SELECT 1 FROM media WHERE id = ?").get(id));
    },
    addPhoto(revision, rollId, id, files) {
      return transaction((row) => {
        if (this.hasUpload(id)) return manage(row);
        const next = addDraftPhoto(row, revision, rollId, id);
        db.prepare("INSERT INTO media (id, source, thumb, full) VALUES (?, ?, ?, ?)")
          .run(id, files.source, files.thumb, files.full);
        db.prepare("UPDATE album SET draft = ?, revision = revision + 1 WHERE id = 1").run(next);
        return manage();
      });
    },
    publish(revision) {
      return transaction((row) => {
        assertRevision(row, revision);
        if (row.published_revision === revision) return manage(row);
        validatePublication(row, revision, (id) => this.hasUpload(id));
        db.prepare("UPDATE album SET published_revision = ?, published = ? WHERE id = 1").run(revision, publicationSnapshot(row));
        return manage();
      });
    },
    preview() {
      const row = get();
      return withMedia(draft(row), row.share_id, "/api/draft-media");
    },
    published(shareId) {
      return readPublished(get(), shareId);
    },
    media(id, variant, shareId) {
      const album = shareId === undefined ? this.preview() : this.published(shareId);
      assertPhoto(album, id);
      const file = variant === "thumb"
        ? db.prepare("SELECT thumb AS file FROM media WHERE id = ?").get(id)
        : db.prepare("SELECT full AS file FROM media WHERE id = ?").get(id);
      if (!file) throw new Problem(404, "This photo could not be found.");
      return file.file;
    },
    localOwner() {
      return db.prepare("SELECT salt, password_hash FROM local_owner WHERE id = 1").get();
    },
    createLocalOwner(salt, passwordHash) {
      transaction(() => {
        const result = db.prepare("INSERT OR IGNORE INTO local_owner VALUES (1, ?, ?)").run(salt, passwordHash);
        if (!result.changes) throw new Problem(409, "An owner password is already set. Sign in instead.");
        db.exec("DELETE FROM session");
      });
    },
    addSession(hash, expires) {
      db.prepare("DELETE FROM session WHERE expires_at <= ?").run(Date.now());
      db.prepare("INSERT INTO session (token_hash, expires_at) VALUES (?, ?)").run(hash, expires);
    },
    sessionValid(hash) {
      return Boolean(db.prepare("SELECT 1 FROM session WHERE token_hash = ? AND expires_at > ?").get(hash, Date.now()));
    },
    deleteSession(hash) {
      db.prepare("DELETE FROM session WHERE token_hash = ?").run(hash);
    },
    close() { db.close(); },
  };
}
