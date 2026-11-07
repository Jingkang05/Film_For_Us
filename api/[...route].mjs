import { openBlobAlbum } from "../server/blob-album.mjs";
import { createHandler } from "../server/index.mjs";

const origin = new URL(process.env.APP_ORIGIN ?? `https://${process.env.VERCEL_URL}`).origin;

export default createHandler({
  data: openBlobAlbum(),
  origin,
  password: process.env.OWNER_PASSWORD,
  allowStoredOwner: true,
});
