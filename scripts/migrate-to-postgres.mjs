import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { platformConfig } from "../server/platform-config.mjs";
import { openDatabase } from "../server/database.mjs";
import { createR2Storage, r2Config } from "../server/r2-storage.mjs";
import { openR2Album } from "../server/r2-album.mjs";
import { validateState } from "../server/collection.mjs";
import { persistAlbum, albumFromRecord } from "../server/postgres-album.mjs";
import { contentHash } from "./storage-migration.mjs";
import { readBytes, sha256, StorageConflict } from "../server/object-storage.mjs";

// Pure transformation preserves every draft, publication, alias, asset binding,
// upload inventory and revision. Recovery extras are archived, not made public.
export function migrationRows(state) {
  validateState(state);
  return [state.album, ...(state.albums ?? [])].map(row => ({ ...row,
    uploaded: [...(row.legacy === false ? row.uploaded : state.uploaded)] }));
}
export function verifyLegacyAdministrator(state, password) {
  if (!state.owner || typeof password !== "string" || password.length < 12) throw new Error("The existing administrator password is required through LEGACY_ADMIN_PASSWORD.");
  const actual = scryptSync(password, state.owner.salt, 64), expected = Buffer.from(state.owner.password_hash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) throw new Error("Legacy administrator identity verification failed.");
}
export async function importState({ db, state, digest, ownerId, administratorEmail }) {
  if (digest !== contentHash(state)) throw new Error("Backup checksum mismatch.");
  const rows = migrationRows(state);
  return db.transaction(async c => {
    await c.query("select pg_advisory_xact_lock(hashtextextended('ffu-migration',0))");
    const { rows: [owner] } = await c.query("select id,email,email_confirmed_at from auth.users where id=$1", [ownerId]);
    const { rows: [session] } = await c.query("select 1 from ffu.app_sessions a join auth.sessions s on s.id=a.auth_session_id and s.user_id=a.user_id where a.user_id=$1 and a.expires_at>now() and (s.not_after is null or s.not_after>now()) limit 1",[ownerId]);
    if (!owner?.email_confirmed_at || owner.email.toLowerCase() !== administratorEmail?.trim().toLowerCase() || !session) throw new Error("Explicit administrator UUID, confirmed email and active OTP application session must agree.");
    const { rows: [existing] } = await c.query("select owner_id,album_count from ffu.imports where digest=$1", [digest]);
    if (existing) {
      if (existing.owner_id !== ownerId) throw new Error("This backup was imported for another owner.");
      // Never replay a backup over subsequent creator edits.
      return { alreadyImported: true, albums: existing.album_count, digest };
    }
    // A second, different snapshot must never overwrite a completed import.
    if ((await c.query("select 1 from ffu.albums where id=any($1::text[])", [rows.map(r=>r.share_id)])).rowCount) throw new Error("An album already exists. Use an explicit reviewed forward repair; no overwrite performed.");
    await c.query("insert into ffu.profiles(id) values($1) on conflict(id) do nothing",[ownerId]);
    for (const row of rows) {
      await persistAlbum(c,row,ownerId,{insert:true,uploaded:row.uploaded});
      const { rows:[stored] } = await c.query("select * from ffu.albums where id=$1",[row.share_id]);
      const roundTrip = albumFromRecord(stored);
      for (const key of ["share_id","revision","published_revision"]) if (roundTrip[key] !== row[key]) throw new Error("Migration identity/revision mismatch.");
      for (const key of ["draft","published"]) if (contentHash(roundTrip[key] && JSON.parse(roundTrip[key])) !== contentHash(row[key] && JSON.parse(row[key]))) throw new Error("Migration content mismatch.");
      if (contentHash(roundTrip.uploaded) !== contentHash(row.uploaded)) throw new Error("Migration upload inventory mismatch.");
    }
    // Exclude the old credential and session data from the database archive.
    // The exact private R2 backup retains them for operator recovery only.
    const { owner: _owner, sessions: _sessions, attempts: _attempts, uploadAttempts: _uploads, ...archive } = state;
    await c.query("insert into ffu.imports(digest,owner_id,album_count,archive) values($1,$2,$3,$4)",[digest,ownerId,rows.length,archive]);
    return { albums:rows.length, photos:rows.reduce((n,r)=>n+JSON.parse(r.draft).rolls.flatMap(r=>r.photos).length,0), digest };
  });
}
async function privateSave(path, bytes) {
  const absolute = resolve(path);
  if (!absolute.startsWith(resolve(".data") + "/")) throw new Error("Migration artifacts must stay under ignored .data/.");
  await mkdir(dirname(absolute),{recursive:true,mode:0o700});
  await writeFile(absolute,bytes,{mode:0o600,flag:"wx"});
}
async function main() {
  const [command, file] = process.argv.slice(2);
  if (!file || !["export","import","verify"].includes(command)) throw new Error("Usage: migrate-to-postgres.mjs export|import|verify .data/<fresh-backup>.json");
  if (process.env.STORAGE_WRITE_FREEZE !== "true" || process.env.MIGRATION_FREEZE_CONFIRMED !== "true") throw new Error("Confirm the LIVE legacy deployment is frozen and in-flight writes have drained. Setting a local flag alone does not freeze Production.");
  const objects = createR2Storage(r2Config()), legacy = openR2Album(objects);
  if (command === "export") {
    const state = await legacy.exportState(); validateState(state);
    const bytes = Buffer.from(JSON.stringify(state)), digest = contentHash(state);
    const key = `roll-for-us/backups/pre-postgres-${sha256(bytes)}.json`;
    try { await objects.put(key,bytes,{createOnly:true,contentType:"application/json"}); }
    catch(error) { if (!(error instanceof StorageConflict)) throw error; }
    if (!(await readBytes(await objects.read(key)))?.equals(bytes)) throw new Error("Private R2 backup readback failed.");
    if (contentHash(await legacy.exportState()) !== digest) throw new Error("R2 metadata changed during backup. Keep the freeze and retry with a new file.");
    await privateSave(file,bytes);
    await privateSave(`${file}.manifest.json`,JSON.stringify({digest,byteSha256:sha256(bytes),backupKey:key,albums:migrationRows(state).map(r=>({id:r.share_id,revision:r.revision,status:r.status,photoCount:JSON.parse(r.draft).rolls.flatMap(r=>r.photos).length})),createdAt:new Date().toISOString()},null,2));
    console.log(JSON.stringify({verified:true,digest,albums:migrationRows(state).length})); return;
  }
  const bytes=await readFile(file), state=JSON.parse(bytes), manifest=JSON.parse(await readFile(`${file}.manifest.json`,"utf8"));
  if (manifest.byteSha256!==sha256(bytes) || manifest.digest!==contentHash(state)) throw new Error("Backup integrity failed.");
  if (contentHash(await legacy.exportState())!==manifest.digest) throw new Error("Live R2 changed after export. No database changes made.");
  if (!(await readBytes(await objects.read(manifest.backupKey)))?.equals(bytes)) throw new Error("Remote backup integrity failed.");
  verifyLegacyAdministrator(state, process.env.LEGACY_ADMIN_PASSWORD);
  const config=platformConfig(), db=openDatabase(config);
  try {
    if(command === "verify") {
      const report=await db.transaction(async c=>{
        const {rows:[record]}=await c.query("select owner_id,album_count from ffu.imports where digest=$1",[manifest.digest]);
        if(!record || record.owner_id!==process.env.MIGRATION_OWNER_ID) throw new Error("Verified import record required.");
        for(const row of migrationRows(state)) {
          const {rows:[stored]}=await c.query("select * from ffu.albums where id=$1",[row.share_id]);
          if(!stored || stored.owner_id!==record.owner_id || stored.version!==row.revision || contentHash(stored.draft)!==contentHash(JSON.parse(row.draft)) || contentHash(stored.published)!==contentHash(row.published?JSON.parse(row.published):null)) throw new Error("Post-import validation failed; keep the freeze.");
        }
        return {verified:true,albums:record.album_count,digest:manifest.digest};
      });console.log(JSON.stringify(report));return;
    }
    console.log(JSON.stringify(await importState({db,state,digest:manifest.digest,ownerId:process.env.MIGRATION_OWNER_ID,administratorEmail:process.env.MIGRATION_OWNER_EMAIL})));
  } finally {await db.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main().catch(()=>{console.error("Migration stopped. Check configuration, verified administrator proof, freeze and private backup. No credentials logged.");process.exitCode=1;});
