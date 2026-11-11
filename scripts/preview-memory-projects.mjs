// Explicit local-only fixture server. This script is never imported by the hosted API.
import { createServer } from "node:http";
import { createHandler } from "../server/index.mjs";
import { Problem } from "../server/album.mjs";
import { albumA, albumB } from "../test/fixtures/memory-projects.mjs";
const port = Number(process.env.PORT ?? 4182);
const fixtures = new Map([albumA, albumB].map(album => [album.id, album]));
export const fixtureData = { published(id) {
  const album = fixtures.get(id);
  if (!album) throw new Problem(404, "This album has not been published yet.");
  return structuredClone(album);
} };
export function fixtureServer() {
  const handler = createHandler({ data: fixtureData, origin: `http://127.0.0.1:${port}` });
  return createServer((req, res) => {
    // No editor, authentication, uploads or storage mutations in fixture mode.
    if (req.method !== "GET" || /^\/api\/(?:manage|preview|draft-media)/.test(req.url)) {
      res.writeHead(404); return res.end();
    }
    return handler(req, res);
  });
}
if (process.argv[1]?.endsWith("preview-memory-projects.mjs")) {
  fixtureServer().listen(port, "127.0.0.1", () => {
    for (const id of fixtures.keys()) console.log(`http://127.0.0.1:${port}/a/${id}`);
  });
}
