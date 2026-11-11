import { openStorage } from "../server/storage.mjs";

// Builds are network-free by default. Explicit metadata checks do not scan media
// or create backups. Deep audits belong to separately budgeted maintenance jobs.
if (process.env.STORAGE_PREFLIGHT === "metadata") {
  const result = await openStorage().verifyExisting("OhqQkmPtTAlxEkHH");
  console.log("Production storage verified:", JSON.stringify(result));
} else {
  console.log("Build storage reads skipped; explicit migration verification is required before cutover.");
}
