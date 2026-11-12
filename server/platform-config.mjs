export function platformConfig(env = process.env) {
  const environment = env.VERCEL_ENV || "development";
  const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL", "SESSION_ENCRYPTION_KEY", "SUPABASE_ENVIRONMENT", "SUPABASE_PRODUCTION_REF"];
  for (const key of required) if (!env[key]) throw new Error(`Missing server configuration: ${key}`);
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || url.pathname !== "/" || url.search || url.hash || url.username) throw new Error("Invalid SUPABASE_URL.");
  const ref = url.hostname.split(".")[0];
  if (env.SUPABASE_ENVIRONMENT !== environment) throw new Error("SUPABASE_ENVIRONMENT must match the deployment environment.");
  if (environment !== "production" && ref === env.SUPABASE_PRODUCTION_REF) throw new Error("Non-production cannot use the Production database.");
  if (environment === "production" && ref !== env.SUPABASE_PRODUCTION_REF) throw new Error("Production project reference mismatch.");
  const database = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !(database.hostname === `db.${ref}.supabase.co` || database.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(database.username).endsWith(`.${ref}`))) throw new Error("DATABASE_URL must belong to the selected Supabase project.");
  if (!/^[a-f0-9]{64}$/.test(env.SESSION_ENCRYPTION_KEY)) throw new Error("SESSION_ENCRYPTION_KEY must be 32 random bytes encoded as hex.");
  if (!env.SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) throw new Error("Use a Supabase publishable key, never a secret key, for Auth.");
  return { url: url.origin, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, databaseUrl: env.DATABASE_URL,
    encryptionKey: Buffer.from(env.SESSION_ENCRYPTION_KEY, "hex"), environment, ref };
}
