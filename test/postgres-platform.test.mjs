import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { postgresFixture } from "./support/postgres-fixture.mjs";
import { objectFixture, stateFixture } from "./support/object-fixture.mjs";
import { openPostgresAlbum, persistAlbum } from "../server/postgres-album.mjs";
import { mediaKey } from "../server/r2-album.mjs";

test("PostgreSQL migration, real two-user RLS, ownership, publication, media and concurrency", async t => {
  const db = await postgresFixture(); t.after(() => db.close());
  const a = randomUUID(), b = randomUUID(), objects = objectFixture();
  for (const id of [a,b]) await db.transaction(async c => {
    await c.query("insert into auth.users(id) values($1)", [id]);
    await c.query("insert into ffu.profiles(id) values($1)", [id]);
  });
  const auth = { requireUser: async req => ({ userId: req.user, sessionId: randomUUID() }), rateLimit: async () => {} };
  const data = openPostgresAlbum({ db, objects, auth });
  const as = (user, work) => data.runRequest(async () => { await data.authenticate({ user }); return work(); });
  const created = await as(a, () => data.create("A private memory")), id = created.shareId;
  assert.deepEqual(await as(b, () => data.list()), []);
  assert.equal((await as(a, () => data.list())).length, 1);
  for (const work of [() => data.manage(id), () => data.preview(id), () => data.save(0, created.album, id),
    () => data.remove(0,id,id), () => data.uploadTarget(randomUUID(),0,20971520,id,undefined,100), () => data.media(randomUUID(),"thumb",undefined,id)]) {
    await assert.rejects(as(b, work), { status: 404 });
  }
  const sqlAs = (userId, work) => db.transaction(work, { userId, sessionId: randomUUID() });
  assert.equal((await sqlAs(b,c => c.query("select * from ffu.albums"))).rows.length, 0);
  assert.equal((await sqlAs(b,c => c.query("update ffu.albums set title='stolen' where id=$1",[id]))).rowCount, 0);
  await assert.rejects(sqlAs(a,c => c.query("update ffu.albums set owner_id=$2 where id=$1",[id,b])), /immutable|row-level security/);
  await assert.rejects(sqlAs(b,c => c.query("insert into ffu.albums(id,owner_id,title,publication_status,draft) values('BBBBBBBBBBBBBBBB',$1,'x','draft','{}')",[a])), /row-level security/);
  const next = structuredClone(created.album); next.title = "Saved";
  await as(a, () => data.save(0,next,id));
  await assert.rejects(as(a, () => data.save(0,next,id)), { status: 409 });
  const concurrent = await Promise.allSettled([as(a,()=>data.save(1,{...next,title:"Concurrent A"},id)),as(a,()=>data.save(1,{...next,title:"Concurrent B"},id))]);
  assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(concurrent.find(r=>r.status==="rejected").reason.status,409);
  assert.match((await as(a, () => data.manage(id))).album.title, /^Concurrent /);
  await assert.rejects(data.published(id), { status: 404 });
  // Import a synthetic legacy publication to verify stable IDs and R2 keys.
  const state = stateFixture(), row = state.album;
  await db.transaction(c => persistAlbum(c,row,a,{insert:true,uploaded:state.uploaded}));
  const first = JSON.parse(row.draft).rolls[0].photos[0].id;
  assert.match((await as(a,()=>data.manage(row.share_id))).album.rolls[0].photos[0].thumb,new RegExp(`^/api/editor/${row.share_id}/media/`));
  await objects.put(mediaKey("roll-for-us",row,first,"thumb"),Buffer.from("synthetic webp"));
  const publication = await data.published("offline-fixture");
  assert.equal(publication.id,row.share_id);
  assert.ok(!JSON.stringify(publication).includes(a));
  assert.ok(!JSON.stringify(publication).includes("assetId"));
  assert.equal((await data.media(first,"thumb","offline-fixture")).status,200);
  const { etag } = await data.media(first,"thumb","offline-fixture");
  assert.equal((await data.media(first,"thumb","offline-fixture",undefined,etag)).status,304);
  await as(a, () => data.unpublish(0,row.share_id));
  await assert.rejects(data.media(first,"thumb","offline-fixture",undefined,etag),{status:404});
  assert.equal((await as(a,() => data.preview(row.share_id))).id,row.share_id);
  await as(a, () => data.publish(1,row.share_id));
  assert.equal((await data.published("offline-fixture")).id,row.share_id);
  const draft = (await as(a,() => data.manage(row.share_id))).album;
  draft.rolls[0].photos = [];
  await as(a,() => data.save(2,draft,row.share_id));
  assert.equal((await data.media(first,"thumb","offline-fixture")).status,200);
  await assert.rejects(as(a,() => data.media(first,"thumb",undefined,row.share_id)), {status:404});
  const photos = await sqlAs(b,c=>c.query("select * from ffu.photos")); assert.equal(photos.rows.length,0);
  assert.equal((await sqlAs(b,c=>c.query("delete from ffu.photos where album_id=$1 returning *",[row.share_id]))).rowCount,0);
  await assert.rejects(sqlAs(a,c=>c.query("delete from ffu.share_addresses where address='offline-fixture'")),/permanent/);
  await as(a,()=>data.remove(3,row.share_id,row.share_id));
  await assert.rejects(data.published("offline-fixture"),{status:404});
  assert.ok(objects.files.size>0,"deleting album retains immutable R2 media");
  const rls = await db.pg.query("select relname,relrowsecurity from pg_class where relnamespace='ffu'::regnamespace and relkind='r'");
  assert.ok(rls.rows.length>=8 && rls.rows.every(r=>r.relrowsecurity));
});
