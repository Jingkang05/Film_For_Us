import { openBlobAlbum } from "./blob-album.mjs";
import { createR2Storage, r2Config } from "./r2-storage.mjs";
import { openR2Album } from "./r2-album.mjs";

export function openStorage(env = process.env) {
  const provider = env.STORAGE_PROVIDER || "vercel-blob";
  // The existing Blob credential is shared across Vercel targets. A preview
  // must not silently open production state while isolated R2 setup is pending.
  if (env.VERCEL_ENV === "preview" && provider === "vercel-blob") throw new Error("Preview storage requires isolated R2 configuration; shared production Blob access is disabled.");
  if (provider === "vercel-blob") return openBlobAlbum();
  if (provider !== "r2") throw new Error("Unsupported STORAGE_PROVIDER.");
  return openR2Album(createR2Storage(r2Config(env)));
}
