import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import sharp from "sharp";
import { createApp } from "../server/index.mjs";

test("private uploads, revision checks, and published snapshots survive restart", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "roll-for-us-test-"));
  const dbPath = join(temp, "album.sqlite");
  const password = randomUUID();
  const origin = "http://127.0.0.1";
  let server;
  let base;
  let cookie;
  async function start() {
    server = createApp({ dbPath, password, origin });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  t.after(async () => {
    await stop();
    await rm(temp, { recursive: true, force: true });
  });
  function request(path, { method = "GET", payload, auth = true, type = "application/json", from = origin } = {}) {
    const headers = {};
    if (auth && cookie) headers.Cookie = cookie;
    if (method === "POST") {
      headers.Origin = from;
      headers["Content-Type"] = type;
    }
    return fetch(base + path, {
      method, headers, body: payload === undefined || type !== "application/json" ? payload : JSON.stringify(payload),
    });
  }
  async function post(route, payload, status = 200) {
    const result = await request(`/api/manage/${route}`, { method: "POST", payload });
    assert.equal(result.status, status, `POST ${route}`);
    return result.json();
  }
  await start();
  assert.equal((await request("/api/preview")).status, 401);
  assert.equal((await request("/api/manage/publish", { method: "POST", payload: {} })).status, 401);
  assert.equal((await request("/api/manage/setup", { method: "POST", payload: { password } })).status, 403);
  assert.equal((await request("/api/manage/login", {
    method: "POST", payload: { password }, from: "https://other.example",
  })).status, 403);

  const login = await request("/api/manage/login", { method: "POST", payload: { password } });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  let draft = await login.json();
  const share = `/api/a/${draft.shareId}`;
  assert.equal((await request(share, { auth: false })).status, 404);
  assert.equal(draft.album.rolls.flatMap((roll) => roll.photos).length, 0);

  const sample = await sharp({
    create: { width: 2100, height: 1000, channels: 3, background: "#dd9977" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rejected = randomUUID();
  const upload = (id, roll, revision, payload) => request(
    `/api/manage/upload?id=${id}&roll=${roll}&revision=${revision}`,
    { method: "POST", payload, type: "image/jpeg" },
  );
  assert.equal((await upload(rejected, "roll-1", draft.revision, Buffer.from("bad file"))).status, 415);

  const ids = [];
  for (const roll of draft.album.rolls) {
    for (let i = 0; i < 6; i++) {
      const id = roll.id === "roll-1" && i === 0 ? rejected : randomUUID();
      ids.push(id);
      const result = await upload(id, roll.id, draft.revision, sample);
      assert.equal(result.status, 200);
      draft = await result.json();
    }
  }

  const firstPhoto = draft.album.rolls[0].photos[0];
  assert.equal(firstPhoto.note, "");
  const repeat = await upload(ids[0], "roll-1", 0, sample);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).revision, draft.revision);
  assert.equal((await request(firstPhoto.full, { auth: false })).status, 401);
  const full = await request(firstPhoto.full);
  assert.equal(full.status, 200);
  const metadata = await sharp(Buffer.from(await full.arrayBuffer())).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height, metadata.orientation, metadata.exif],
    ["webp", 857, 1800, undefined, undefined]);
  const thumb = await request(firstPhoto.thumb);
  assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).height, 480);
  assert.equal((await request(share, { auth: false })).status, 404);

  const preEdit = draft.revision;
  const letter = "Dear you,\n\n这是一封用来测试发布流程的信。";
  draft.album.letter = letter;
  draft.album.shareSlug = " Our-Story ";
  for (const [index, roll] of draft.album.rolls.entries()) {
    roll.name = `胶卷 ${index + 1}`;
    for (const photo of roll.photos) {
      photo.date = "2026-11-06";
    }
  }
  const moved = draft.album.rolls[0].photos.pop();
  draft.album.rolls[1].photos.unshift(moved);
  delete firstPhoto.note;
  draft = await post("save", { revision: preEdit, album: draft.album });
  assert.equal(draft.album.shareSlug, "our-story");
  assert.equal(draft.shareSlug, "");
  assert.equal((await request("/api/a/our-story", { auth: false })).status, 404);
  assert.equal(draft.album.rolls[1].photos[0].id, moved.id);
  await post("save", { revision: preEdit, album: draft.album }, 409);
  await post("publish", { revision: preEdit }, 409);
  assert.equal((await request(share)).status, 404);
  const publish = await post("publish", { revision: draft.revision });
  draft = publish;
  assert.equal(publish.shareSlug, "our-story");
  assert.equal((await request("/a/our-story", { auth: false })).status, 200);
  assert.equal((await request("/api/a/our-story", { auth: false })).status, 200);
  assert.equal((await request("/api/a/not-this-album", { auth: false })).status, 404);
  for (const shareSlug of ["../manage", "our/story", "-story", "story?x=1", "a".repeat(81), "<script>", "我们的回忆", "café"]) {
    await post("save", { revision: draft.revision, album: { ...draft.album, shareSlug } }, 422);
  }
  assert.deepEqual(await post("publish", { revision: draft.revision }), publish);

  const publicAlbum = await (await request(share, { auth: false })).json();
  assert.equal(publicAlbum.letter, letter);
  assert.equal(publicAlbum.rolls.flatMap((roll) => roll.photos).length, 18);
  const publishedPhoto = publicAlbum.rolls[0].photos[0];
  assert.equal(publishedPhoto.note, "");
  assert.equal((await request(publishedPhoto.full, { auth: false })).status, 200);
  assert.equal((await request(publishedPhoto.full.replace("/full", "/source"), { auth: false })).status, 404);

  draft.album.rolls[0].photos.shift();
  draft.album.rolls[0].photos[0].date = "";
  draft = await post("save", { revision: draft.revision, album: draft.album });
  const missingDate = await post("publish", { revision: draft.revision }, 422);
  assert.equal(missingDate.error, "Add a date to each photo before publishing.");
  assert.equal((await request(firstPhoto.full)).status, 404);
  assert.equal((await request(publishedPhoto.full, { auth: false })).status, 200);

  await stop();
  await start();
  assert.equal((await (await request("/api/manage")).json()).revision, draft.revision);
  assert.equal((await request(publishedPhoto.full, { auth: false })).status, 200);
  draft.album.rolls[0].photos[0].date = "2026-11-06";
  draft.album.rolls[0].photos[0].note = "修订后的测试留言。";
  draft.album.shareSlug = "our-memories";
  draft = await post("save", { revision: draft.revision, album: draft.album });
  assert.equal(draft.shareSlug, "our-story");
  assert.equal((await request(`/api/a/${encodeURIComponent("our-memories")}`, { auth: false })).status, 404);
  draft = await post("publish", { revision: draft.revision });
  assert.equal((await request(publishedPhoto.full, { auth: false })).status, 404);
  const latest = await (await request(share, { auth: false })).json();
  assert.equal(latest.rolls[0].photos[0].note, "修订后的测试留言。");
  assert.equal(latest.rolls.flatMap((roll) => roll.photos).length, 17);
  assert.equal((await request("/api/a/our-story", { auth: false })).status, 200);
  const renamedLink = `/api/a/${encodeURIComponent("our-memories")}`;
  assert.equal((await request(renamedLink, { auth: false })).status, 200);
  assert.equal((await request(`/a/${encodeURIComponent("our-memories")}`, { auth: false })).status, 200);
  assert.equal((await request(`/api/a/our-story/media/${latest.rolls[0].photos[0].id}/full`, { auth: false })).status, 200);
  assert.equal(latest.shareAliases, undefined);

  draft.album.shareSlug = "";
  draft = await post("save", { revision: draft.revision, album: draft.album });
  const reset = await post("publish", { revision: draft.revision });
  assert.equal(reset.shareSlug, "");
  await stop();
  await start();
  for (const link of [share, "/api/a/our-story", renamedLink]) {
    assert.equal((await request(link, { auth: false })).status, 200, link);
  }

  await post("logout", {});
  assert.equal((await request("/api/manage")).status, 401);
});
