import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHandler } from "../server/index.mjs";
import { initializeR2State, openR2Album } from "../server/r2-album.mjs";
import { sha256 } from "../server/object-storage.mjs";
import { objectFixture } from "../test/support/object-fixture.mjs";

const [stateFile, inventoryFile] = process.argv.slice(2);
if (!inventoryFile) throw new Error("Explicit private state and inventory paths are required.");
const state = JSON.parse(await readFile(stateFile)), inventory = JSON.parse(await readFile(inventoryFile)), objects = objectFixture();
for (const o of inventory.objects) {
  const bytes = await readFile(o.localFile);
  if (sha256(bytes) !== o.sha256 || bytes.length !== o.size) throw new Error("Recovery byte verification failed.");
  await objects.put(o.key, bytes, { contentType: o.contentType });
}
await initializeR2State(objects, state);
const port = Number(process.env.PORT ?? 4176), origin = `http://127.0.0.1:${port}`;
const server = createServer(createHandler({ data: openR2Album(objects), origin, allowStoredOwner: true }));
server.listen(port, "127.0.0.1", () => console.log(`Private loopback partial-recovery preview: ${origin}/a/${state.album.share_id}`));
