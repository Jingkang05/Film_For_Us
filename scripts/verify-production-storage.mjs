import { openBlobAlbum } from "../server/blob-album.mjs";

// A production build cannot replace the live site unless its existing album,
// private backup, uploaded assets and administrator protection all verify.
// Builds never rewrite metadata, publication state, IDs or media.
if (process.env.VERCEL_ENV === "production") {
  const result = await openBlobAlbum().verifyExisting("OhqQkmPtTAlxEkHH");
  console.log("Production storage verified:", JSON.stringify(result));
} else {
  console.log("Production storage preflight skipped outside the production environment.");
}
