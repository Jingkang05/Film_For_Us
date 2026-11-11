// Synthetic operation accounting only. No credentials, HTTP server, or real Blob access.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { openBlobAlbum, createState, albumStatePath, photoPath } from "../server/blob-album.mjs";
import { createHandler } from "../server/index.mjs";

globalThis.fetch = async () => { throw new Error("Network access forbidden in this offline audit"); };
const prefix = "synthetic-offline-audit", path = albumStatePath(prefix);
const state = createState();
state.owner = { salt: "a".repeat(32), password_hash: "b".repeat(128) };
const content = JSON.parse(state.album.draft);
for (let i = 0; i < 29; i++) {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  content.rolls[i % 3].photos.push({ id, note: "", date: "" });
  state.uploaded.push(id);
}
state.album.draft = JSON.stringify(content);
state.album.published = state.album.draft;
state.album.published_revision = 0;
const token = "c".repeat(64);
state.sessions[createHash("sha256").update(token).digest("hex")] = Date.now() + 60000;
const files = new Map([[path, Buffer.from(JSON.stringify(state))]]);
for (const id of state.uploaded) for (const variant of ["source", "thumb", "full"]) files.set(photoPath(prefix, id, variant), Buffer.from("synthetic"));
let calls = [];
const blob = {
  async get(target, options) {
    calls.push({ method: "get", target, bypass: options.useCache === false });
    const bytes = files.get(target);
    return bytes && { stream: new Response(bytes).body, blob: { etag: '"synthetic"', size: bytes.length } };
  },
  async head(target) { calls.push({ method: "head", target }); assert.ok(files.has(target)); return {}; },
  async put(target, bytes) { calls.push({ method: "put", target }); files.set(target, Buffer.from(bytes)); return { etag: '"synthetic"' }; },
};
const store = openBlobAlbum(prefix, blob);
const handler = createHandler({ data: store, origin: "https://offline.invalid", password: "synthetic-password", allowStoredOwner: true });
const storedOwnerHandler = createHandler({ data: store, origin: "https://offline.invalid", allowStoredOwner: true });
const output = [];
async function measure(label, work, expected) {
  calls = [];
  await work();
  const count = {
    uncachedGets: calls.filter(c => c.method === "get" && c.bypass).length,
    cacheEligibleGets: calls.filter(c => c.method === "get" && !c.bypass).length,
    heads: calls.filter(c => c.method === "head").length,
    puts: calls.filter(c => c.method === "put").length,
  };
  assert.deepEqual(count, expected, label);
  output.push({ label, ...count });
}
async function request(url, owner = false, route = handler) {
  const req = Readable.from([]);
  Object.assign(req, { url, method: "GET", headers: owner ? { cookie: `roll_session=${token}` } : {}, socket: {} });
  const headers = {};
  const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, writeHead(status, values) { this.status = status; for (const [k, v] of Object.entries(values)) this.setHeader(k, v); }, end() {} };
  await route(req, res);
  assert.equal(res.status, 200);
  assert.equal(headers["cache-control"], "no-store");
}
const publicBase = `/api/a/${state.album.share_id}`;
const image = `${publicBase}/media/${state.uploaded[0]}`;
await measure("Open album JSON", () => request(publicBase), { uncachedGets: 1, cacheEligibleGets: 0, heads: 0, puts: 0 });
for (const label of ["View one frame: thumb + full", "Repeat the same frame: thumb + full"]) {
  await measure(label, async () => { await request(`${image}/thumb`); await request(`${image}/full`); }, { uncachedGets: 2, cacheEligibleGets: 2, heads: 0, puts: 0 });
}
await measure("Fetch both variants for all 29 photos, plus JSON", async () => {
  await request(publicBase);
  for (const id of state.uploaded) for (const variant of ["thumb", "full"]) await request(`${publicBase}/media/${id}/${variant}`);
}, { uncachedGets: 59, cacheEligibleGets: 58, heads: 0, puts: 0 });
const editorImage = `/api/editor/${state.album.share_id}/media/${state.uploaded[0]}/thumb`;
await measure("Editor image with environment password", () => request(editorImage, true), { uncachedGets: 2, cacheEligibleGets: 1, heads: 0, puts: 0 });
await measure("Editor image with stored owner", () => request(editorImage, true, storedOwnerHandler), { uncachedGets: 3, cacheEligibleGets: 1, heads: 0, puts: 0 });
await measure("Metadata-only preflight: no asset checks or backup writes", () => store.verifyExisting(state.album.share_id), { uncachedGets: 1, cacheEligibleGets: 0, heads: 0, puts: 0 });
await measure("Explicit deep audit: synthetic fixtures only", () => store.verifyExisting(state.album.share_id, { deep: true }), { uncachedGets: 3, cacheEligibleGets: 0, heads: 87, puts: 1 });
console.log(JSON.stringify({ result: "PASS", productionRequests: 0, scenarios: output }, null, 2));
