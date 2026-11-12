import { AsyncLocalStorage } from "node:async_hooks";
import { collectionStore } from "./collection.mjs";
import { albumStatus, initialAlbum, manageAlbum, Problem, readPublished, text, withMedia } from "./album.mjs";
import { immutableCache, readBytes, sha256, StorageConflict } from "./object-storage.mjs";
import { mediaKey } from "./r2-album.mjs";

export const albumFromRecord = r => ({ share_id: r.id, revision: r.version, published_revision: r.published_version,
  draft: JSON.stringify(r.draft), published: r.published ? JSON.stringify(r.published) : null,
  status: r.publication_status, deleted: r.publication_status === "deleted", legacy: r.legacy_media ? undefined : false,
  uploaded: r.uploaded, storageBytes: Number(r.storage_bytes), createdAt: r.created_at?.toISOString?.() ?? r.created_at,
  updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at });

export async function persistAlbum(c, row, ownerId, { insert = false, uploaded = row.uploaded ?? [], prefix = "roll-for-us" } = {}) {
  const draft = JSON.parse(row.draft), published = row.published ? JSON.parse(row.published) : null;
  const values = [row.share_id, ownerId, draft.title, draft.description ?? "", albumStatus(row), draft, published,
    row.revision, row.published_revision, row.legacy !== false, uploaded, row.storageBytes ?? 0,
    row.createdAt ?? new Date().toISOString(), row.updatedAt ?? new Date().toISOString()];
  if (insert) await c.query(`insert into ffu.albums(id,owner_id,title,description,publication_status,draft,published,version,published_version,legacy_media,uploaded,storage_bytes,created_at,updated_at,published_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,case when $5='published' then $14::timestamptz end)`, values);
  else await c.query(`update ffu.albums set title=$3,description=$4,publication_status=$5,draft=$6,published=$7,version=$8,published_version=$9,
    legacy_media=$10,uploaded=$11,storage_bytes=$12,created_at=$13,updated_at=$14,published_at=case when $5='published' and published_version is distinct from $9 then $14::timestamptz else published_at end
    where id=$1 and owner_id=$2`, values);
  const addresses = new Set([row.share_id, draft.shareSlug, published?.shareSlug, ...(published?.shareAliases ?? [])].filter(Boolean));
  if (!insert) {
    const { rows: reserved } = await c.query("select address from ffu.share_addresses where album_id=$1",[row.share_id]);
    const known = new Set(reserved.map(r=>r.address));
    const added = [...addresses].filter(address=>!known.has(address)).length;
    if (added && reserved.length + added > 100) throw new Problem(422,"This album has reached its sharing-address limit.");
  }
  for (const address of addresses) {
    const result = await c.query("insert into ffu.share_addresses(address,album_id) values($1,$2) on conflict(address) do nothing returning album_id", [address, row.share_id]);
    if (!result.rowCount) {
      const existing = await c.query("select album_id from ffu.share_addresses where address=$1", [address]);
      if (existing.rows[0]?.album_id !== row.share_id) throw new Problem(409, "This sharing address is already reserved by another album. Choose another suffix.");
    }
  }
  // Both projections commit atomically with their snapshots. A published photo
  // removed from a later draft remains available until the next publication.
  const records = [];
  for (const [snapshot, content] of [["draft", draft], ["published", published]]) {
    let order = 0;
    for (const roll of content?.rolls ?? []) for (const photo of roll.photos) {
      const asset = photo.assetId ?? photo.id;
      records.push({ snapshot, id: photo.id, asset_id: asset, roll_id: roll.id, display_order: order++, caption: photo.note ?? "", photo_date: photo.date || null,
        original_object_key: mediaKey(prefix,row,asset,"source"), thumbnail_object_key: mediaKey(prefix,row,asset,"thumb"), optimized_object_key: mediaKey(prefix,row,asset,"full") });
    }
  }
  await c.query(`delete from ffu.photos p where album_id=$1 and not exists
    (select 1 from jsonb_to_recordset($2::jsonb) as n(snapshot text,id uuid) where n.snapshot=p.snapshot and n.id=p.id)`,[row.share_id,JSON.stringify(records)]);
  if (records.length) await c.query(`insert into ffu.photos(album_id,snapshot,id,asset_id,roll_id,display_order,caption,photo_date,original_object_key,thumbnail_object_key,optimized_object_key)
    select $1,n.* from jsonb_to_recordset($2::jsonb) as n(snapshot text,id uuid,asset_id uuid,roll_id text,display_order integer,caption text,photo_date date,original_object_key text,thumbnail_object_key text,optimized_object_key text)
    on conflict(album_id,snapshot,id) do update set asset_id=excluded.asset_id,roll_id=excluded.roll_id,display_order=excluded.display_order,caption=excluded.caption,
      photo_date=excluded.photo_date,original_object_key=excluded.original_object_key,thumbnail_object_key=excluded.thumbnail_object_key,optimized_object_key=excluded.optimized_object_key,updated_at=now()`,[row.share_id,JSON.stringify(records)]);
}

export function openPostgresAlbum({ db, objects, auth, prefix = "roll-for-us" }) {
  const request = new AsyncLocalStorage(), bytesCache = immutableCache();
  function identity() { const user = request.getStore()?.user; if (!user) throw new Problem(401, "Sign in to manage the album."); return user; }
  const owned = work => db.transaction(work, identity());
  async function load(c, id, lock = false) {
    if (!/^[A-Za-z0-9_-]{16}$/.test(id ?? "")) throw new Problem(404, "Choose an album in My Studio.");
    const { rows: [record] } = await c.query(`select * from ffu.albums where id=$1 and owner_id=$2 and publication_status<>'deleted'${lock ? " for update" : ""}`, [id, identity().userId]);
    if (!record) throw new Problem(404, "This album could not be found.");
    return albumFromRecord(record);
  }
  const stateOf = row => ({ album: row, uploaded: row.uploaded, owner: null, sessions: {}, attempts: {} });
  const editorResult = result => ({ ...result, album: withMedia(result.album,result.shareId,`/api/editor/${result.shareId}/media`) });
  function selected(id) {
    return collectionStore({ directUpload: true, storageLimitBytes: 2 * 1024 ** 3,
      snapshot: () => owned(async c => ({ state: stateOf(await load(c, id)) })),
      change: update => owned(async c => {
        const row = await load(c, id, true), state = stateOf(row), before = JSON.stringify(row), result = update(state);
        if (JSON.stringify(row) !== before) await persistAlbum(c, row, identity().userId, { uploaded: row.uploaded, prefix });
        return result;
      }),
      writeMedia: async (row, asset, files) => {
        for (const variant of ["thumb", "full"]) {
          const key = mediaKey(prefix, row, asset, variant), bytes = files[variant];
          try { await objects.put(key, bytes, { contentType: "image/webp", createOnly: true }); }
          catch (error) { if (!(error instanceof StorageConflict) || !(await readBytes(await objects.read(key)))?.equals(bytes)) throw new Problem(409, "This upload ID already contains another photo."); }
        }
      },
    });
  }
  async function publicRecord(c, share) {
    // Privileged public read has an explicit publication predicate, never an
    // owner/draft result, even for an authenticated visitor.
    const { rows: [r] } = await c.query(`select a.id,a.published,a.version,a.published_version,a.publication_status,a.legacy_media
      from ffu.share_addresses s join ffu.albums a on a.id=s.album_id where s.address=$1 and a.publication_status='published'`, [share]);
    if (!r) throw new Problem(404, "This album has not been published yet.");
    return { ...r, share_id: r.id, published: JSON.stringify(r.published), status: r.publication_status, legacy: r.legacy_media ? undefined : false };
  }
  return {
    platform: true,
    auth,
    runRequest: work => request.run({}, work),
    async authenticate(req) { const user = await auth.requireUser(req); request.getStore().user = user; return user.userId; },
    localOwner: async () => null,
    async list() { return owned(async c => {
      const { rows } = await c.query(`select id,title,publication_status,version,published_version,published->>'shareSlug' as slug,
        (select count(*)::int from ffu.photos p where p.album_id=a.id and p.snapshot='draft') as photo_count
        from ffu.albums a where owner_id=$1 and publication_status<>'deleted' order by updated_at desc,id limit 100`, [identity().userId]);
      return rows.map(r => ({ id: r.id, title: r.title, status: r.publication_status, revision: r.version, publishedRevision: r.published_version, shareSlug: r.slug ?? "", photoCount: r.photo_count }));
    }); },
    async create(title = "Untitled album") { return owned(async c => {
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [identity().userId]);
      const { rows: [quota] } = await c.query("select count(*)::int as count from ffu.albums where owner_id=$1", [identity().userId]);
      if (quota.count >= 50) throw new Problem(422, "Your Studio has reached its 50 album limit.");
      const row = { ...initialAlbum(), legacy: false, status: "draft", uploaded: [] };
      const content = JSON.parse(row.draft); content.title = text(title, 80); row.draft = JSON.stringify(content);
      await persistAlbum(c, row, identity().userId, { insert: true, prefix });
      return { ...manageAlbum(row), directUpload: true };
    }); },
    manage: id => selected(id).manage(id).then(editorResult),
    preview: id => owned(async c => { const row=await load(c,id);return withMedia(JSON.parse(row.draft),id,`/api/editor/${id}/media`); }),
    save: (revision, input, id) => selected(id).save(revision, input, id).then(editorResult),
    publish: (revision, id) => selected(id).publish(revision, id).then(editorResult),
    unpublish: (revision, id) => selected(id).unpublish(revision, id).then(editorResult),
    remove: (revision, confirmation, id) => selected(id).remove(revision, confirmation, id),
    hasUpload: (asset, id) => selected(id).hasUpload(asset, id),
    checkUpload: (asset, revision, id, replace) => selected(id).checkUpload(asset, revision, id, replace),
    addPhoto: (revision, roll, asset, files, id, replace) => selected(id).addPhoto(revision, roll, asset, files, id, replace).then(editorResult),
    recordUploadAttempt: () => auth.rateLimit("upload", identity().userId, 180, 900),
    published: share => db.transaction(async c => readPublished(await publicRecord(c, share), share)),
    async media(photoId, variant, share, id, ifNoneMatch) {
      if (!["thumb", "full"].includes(variant)) throw new Problem(404, "This photo could not be found.");
      const lookup = async c => {
        const result = share === undefined
          ? await c.query(`select p.thumbnail_object_key,p.optimized_object_key,a.version as version from ffu.photos p join ffu.albums a on a.id=p.album_id
            where a.id=$1 and a.owner_id=$2 and a.publication_status<>'deleted' and p.snapshot='draft' and p.id=$3`,[id,identity().userId,photoId])
          : await c.query(`select p.thumbnail_object_key,p.optimized_object_key,a.published_version as version from ffu.share_addresses s
            join ffu.albums a on a.id=s.album_id join ffu.photos p on p.album_id=a.id
            where s.address=$1 and a.publication_status='published' and p.snapshot='published' and p.id=$2
            and (s.address=a.id or s.address=a.published->>'shareSlug' or (a.published->'shareAliases') ? s.address)`,[share,photoId]);
        if (!result.rows[0]) throw new Problem(404,"This photo could not be found.");
        return result.rows[0];
      };
      const photo = share === undefined ? await owned(lookup) : await db.transaction(lookup);
      const key = variant === "thumb" ? photo.thumbnail_object_key : photo.optimized_object_key;
      const etag = `"${sha256(`${key}:${photo.version}`)}"`;
      if (ifNoneMatch?.split(",").map(x => x.trim().replace(/^W\//, "")).includes(etag)) return { status: 304, etag };
      const bytes = await bytesCache(key, () => readBytesFromR2(key));
      return { status: 200, etag, bytes };
    },
    async uploadTarget(asset, revision, maximum, id, replace, sourceSize) {
      const row = await selected(id).checkUpload(asset, revision, id, replace);
      if (row.uploaded.includes(asset)) return {};
      if (!replace && JSON.parse(row.draft).rolls.flatMap(r=>r.photos).length >= 500) throw new Problem(422,"An album can contain up to 500 photos.");
      if (!Number.isSafeInteger(sourceSize) || sourceSize < 1 || sourceSize > maximum) throw new Problem(413, "Choose a photo of 20 MB or smaller.");
      await owned(async c => {
        await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [identity().userId]);
        await load(c, id, true);
        const { rows: [existing] } = await c.query("select source_size from ffu.uploads where album_id=$1 and asset_id=$2", [id, asset]);
        if (existing) { if (existing.source_size !== sourceSize) throw new Problem(409, "Choose the photo again to create a unique upload ID."); return; }
        const budget = sourceSize + 8 * 1024 ** 2;
        const { rows: [quota] } = await c.query("select coalesce(sum(storage_bytes+upload_budget),0)::text as bytes from ffu.albums where owner_id=$1", [identity().userId]);
        if (Number(quota.bytes) + budget > 2 * 1024 ** 3) throw new Problem(422, "Your Studio has reached its storage limit.");
        await c.query("insert into ffu.uploads(album_id,asset_id,source_size) values($1,$2,$3)", [id, asset, sourceSize]);
        // Lifetime accounting includes failed uploads. Deletion cannot reset it.
        await c.query("update ffu.albums set upload_budget=upload_budget+$2 where id=$1", [id, budget]);
      });
      return objects.signUpload(mediaKey(prefix, row, asset, "source"), { expiresIn: 120, contentLength: sourceSize });
    },
    async uploadSource(asset, maximum, id) {
      const { row, size } = await owned(async c => {
        const row = await load(c, id);
        const { rows: [upload] } = await c.query("select source_size from ffu.uploads where album_id=$1 and asset_id=$2", [id, asset]);
        if (!upload) throw new Problem(422, "Start a new upload before processing this photo.");
        return { row, size: upload.source_size };
      });
      const bytes = await readBytes(await objects.read(mediaKey(prefix, row, asset, "source")), maximum);
      if (!bytes || bytes.length !== size) throw new Problem(422, "The upload size did not match. Choose the photo again.");
      return bytes;
    },
  };
  async function readBytesFromR2(key) {
    const bytes = await readBytes(await objects.read(key), 4 * 1024 ** 2);
    if (!bytes) throw new Problem(404, "This photo could not be found.");
    return bytes;
  }
}
