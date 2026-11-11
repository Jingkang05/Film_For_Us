// In-memory R2-shaped store with public repository samples only. Never loads env,
// the production SQLite database, Cloudflare credentials, or Blob objects.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHandler } from "../server/index.mjs";
import { initializeR2State, openR2Album, mediaKey } from "../server/r2-album.mjs";
import { objectFixture, stateFixture } from "../test/support/object-fixture.mjs";

const objects = objectFixture(), state = stateFixture();
await initializeR2State(objects, state, "preview");
for (const [i, id] of state.uploaded.entries()) {
  const bytes = await readFile(new URL(`../public/samples/${["rain-1", "sea-1", "home-1"][i]}.webp`, import.meta.url));
  for (const variant of ["source", "thumb", "full"]) await objects.put(mediaKey("preview", state.album, id, variant), bytes, { contentType: "image/webp" });
}
const port = Number(process.env.PORT ?? 4175), origin = `http://127.0.0.1:${port}`;
const server = createServer(createHandler({ data: openR2Album(objects, { prefix: "preview" }), origin, password: "synthetic-preview-password", allowStoredOwner: true }));
server.listen(port, "127.0.0.1", () => console.log(`Offline R2 preview: ${origin}/a/${state.album.share_id} · editor password: synthetic-preview-password`));
