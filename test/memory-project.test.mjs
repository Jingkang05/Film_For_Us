import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";
import { once } from "node:events";
import { toMemoryProject, compile } from "./support/memory-model.mjs";
import { albumA, albumB } from "./fixtures/memory-projects.mjs";
import { fixtureServer } from "../scripts/preview-memory-projects.mjs";
import { initialAlbum, readPublished } from "../server/album.mjs";

test("legacy published snapshots retain stable IDs, text and media URLs", () => {
  const row = initialAlbum(); row.share_id = "OhqQkmPtTAlxEkHH";
  row.published = JSON.stringify({ ...albumA, rolls: albumA.rolls.map(roll => ({ ...roll, photos: roll.photos.map(p => ({ id:p.id, date:p.date, note:p.note })) })) });
  const legacy = readPublished(row, row.share_id), project = toMemoryProject(legacy);
  assert.equal(project.id, row.share_id);
  assert.equal(project.envelope.message, legacy.letter);
  assert.deepEqual(project.rolls.map(r => r.photos), legacy.rolls.map(r => r.photos));
  assert.deepEqual(project.settings.music, { title:"Who Knows by Daniel Caesar", src:"/assets/who-knows.m4a?v=2" });
  assert.equal(project.ending.instantCaption, "A small collection of moments worth keeping.");
});
test("one model adapts two independent memories without shared mutation or invented timestamps", () => {
  const a = toMemoryProject(albumA), b = toMemoryProject(albumB);
  assert.equal(b.envelope.message, albumB.envelope.message);
  assert.equal(b.ending.instantCaption, albumB.ending.instantCaption);
  assert.notEqual(a.id,b.id); assert.notEqual(a.title,b.title);
  b.settings.music.title = "Changed"; b.rolls[0].photos[0].note = "Changed";
  assert.equal(toMemoryProject(albumB).settings.music.title, albumB.settings.music.title);
  assert.equal(a.createdAt,undefined); assert.equal(a.updatedAt,undefined);
  assert.deepEqual(toMemoryProject(a),a);
});
test("bad records fail before rendering rather than crashing halfway through an animation", () => {
  for (const value of [null, {}, {...albumA,id:""}, {...albumA,rolls:[]}, {...albumB,templateId:"unknown"},
    {...albumB,settings:{...albumB.settings,music:{title:"x",src:"javascript:alert(1)"}}}]) assert.throws(()=>toMemoryProject(value));
  const duplicate=structuredClone(albumB); duplicate.rolls[1].photos[0].id=duplicate.rolls[0].photos[0].id;
  assert.throws(()=>toMemoryProject(duplicate));
});
test("Phase 1 keys and photo selection survive adaptation, slug changes and reordering", async () => {
  const { loadViewerLikes,saveViewerLikes,viewerLikesKey } = await import(`data:text/javascript;base64,${Buffer.from(await compile('viewer-likes')).toString('base64')}`);
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  const a=toMemoryProject(albumA), ids=a.rolls.flatMap(r=>r.photos.map(p=>p.id));
  saveViewerLikes(a.id,[ids[0]],false,storage);
  const reordered=structuredClone(albumA);reordered.rolls[0].photos.reverse();reordered.shareSlug="new-url";
  const next=toMemoryProject(reordered);
  assert.equal(viewerLikesKey(next.id),`roll-for-us:viewer-likes:v1:album:${encodeURIComponent(a.id)}`);
  assert.deepEqual(loadViewerLikes(next.id,next.rolls.flatMap(r=>r.photos.map(p=>p.id)),false,storage),[ids[0]]);
  assert.deepEqual(loadViewerLikes(albumB.id,ids,false,storage),[]);
});
test("both fixture albums load through existing routes; missing albums and mutations are rejected", async t => {
  const server=fixtureServer();server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const album of [albumA,albumB]) {
    const response=await fetch(`${base}/api/a/${album.id}`); assert.equal(response.status,200);
    assert.equal(toMemoryProject(await response.json()).id,album.id);
    assert.equal((await fetch(`${base}/a/${album.id}`)).status,200);
  }
  assert.equal((await fetch(`${base}/api/a/missing`)).status,404);
  assert.equal((await fetch(`${base}/api/manage/save`,{method:'POST'})).status,404);
});
test("fixture media and template font assets remain existing local files", async () => {
  for (const album of [toMemoryProject(albumA),toMemoryProject(albumB)]) {
    for (const photo of album.rolls.flatMap(r=>r.photos)) {
      for (const path of [photo.full,photo.thumb]) await access(new URL(`../public${path}`,import.meta.url));
    }
  }
  const css=await readFile(new URL('../public/typography.css',import.meta.url),'utf8');
  for(const [,path] of css.matchAll(/url\(["']?(\/assets\/[^)"']+)/g)) await access(new URL(`../public${path}`,import.meta.url));
});
