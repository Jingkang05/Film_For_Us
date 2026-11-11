import { openStorage } from "../server/storage.mjs";
import { createHandler } from "../server/index.mjs";

const origin = new URL(process.env.APP_ORIGIN ?? `https://${process.env.VERCEL_URL}`).origin;

export default createHandler({
  data: openStorage(),
  origin,
  password: process.env.OWNER_PASSWORD,
  allowStoredOwner: true,
  writeFreeze: process.env.STORAGE_WRITE_FREEZE === "true",
});
