import { openBlobAlbum } from "./blob-album.mjs";
import { createR2Storage, r2Config } from "./r2-storage.mjs";
import { openR2Album } from "./r2-album.mjs";
import { platformConfig } from "./platform-config.mjs";
import { openDatabase } from "./database.mjs";
import { createPlatformAuth } from "./platform-auth.mjs";
import { openPostgresAlbum } from "./postgres-album.mjs";

export function openStorage(env = process.env) {
  if (env.ALBUM_DATA_PROVIDER === "postgres") {
    if (env.STORAGE_PROVIDER !== "r2") throw new Error("PostgreSQL mode requires private R2 media storage.");
    const config = platformConfig(env), db = openDatabase(config);
    const origin = new URL(env.APP_ORIGIN ?? `https://${env.VERCEL_URL}`).origin;
    return openPostgresAlbum({ db, objects: createR2Storage(r2Config(env)), auth: createPlatformAuth({ db, config, origin }) });
  }
  if (env.ALBUM_DATA_PROVIDER && env.ALBUM_DATA_PROVIDER !== "legacy") throw new Error("Unsupported ALBUM_DATA_PROVIDER.");
  const provider = env.STORAGE_PROVIDER || "vercel-blob";
  // The existing Blob credential is shared across Vercel targets. A preview
  // must not silently open production state while isolated R2 setup is pending.
  if (env.VERCEL_ENV === "preview" && provider === "vercel-blob") throw new Error("Preview storage requires isolated R2 configuration; shared production Blob access is disabled.");
  if (provider === "vercel-blob") return openBlobAlbum();
  if (provider !== "r2") throw new Error("Unsupported STORAGE_PROVIDER.");
  return openR2Album(createR2Storage(r2Config(env)));
}
