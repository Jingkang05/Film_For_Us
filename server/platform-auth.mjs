import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Problem } from "./album.mjs";

const lifetime = 14 * 24 * 60 * 60;
const hash = value => createHash("sha256").update(value).digest("hex");
const unauthorized = () => new Problem(401, "Your session has expired. Sign in again.");
export function sealTokens(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
export function openTokens(value, key) {
  const bytes = Buffer.from(value, "base64url"), decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
}
export function createPlatformAuth({ db, config, origin, clientFactory }) {
  const secure = new URL(origin).protocol === "https:";
  const name = secure ? "__Host-ffu_session" : "ffu_session";
  const client = clientFactory ?? (() => createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(8000) }) },
  }));
  const cookie = (token, seconds) => `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
  function tokenHash(req) {
    const token = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
    return token && /^[a-f0-9]{64}$/.test(token) ? hash(token) : null;
  }
  async function sessionAlive(c, userId, sessionId) {
    const result = await c.query("select 1 from auth.sessions where id=$1 and user_id=$2 and (not_after is null or not_after > now())", [sessionId, userId]);
    return result.rowCount === 1;
  }
  async function verifyUser(sdk, tokens) {
    const { data, error } = await sdk.auth.getUser(tokens.access_token);
    if (error || !data.user?.email_confirmed_at || data.user.is_anonymous) throw unauthorized();
    // Decode only after Auth verifies the token. Never authorize from editable metadata.
    let claims;
    try { claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url")); } catch { throw unauthorized(); }
    if (claims.sub !== data.user.id || !/^[a-f0-9-]{36}$/.test(claims.session_id ?? "")) throw unauthorized();
    return { userId: data.user.id, sessionId: claims.session_id, email: data.user.email };
  }
  async function requireUser(req) {
    const digest = tokenHash(req);
    if (!digest) throw unauthorized();
    return db.transaction(async c => {
      const { rows: [row] } = await c.query("select * from ffu.app_sessions where token_hash=$1 and expires_at > now() for update", [digest]);
      if (!row || !await sessionAlive(c, row.user_id, row.auth_session_id)) throw unauthorized();
      let tokens;
      try { tokens = openTokens(row.encrypted_tokens, config.encryptionKey); } catch { throw unauthorized(); }
      const sdk = client();
      if (tokens.expires_at * 1000 < Date.now() + 60000) {
        const { data, error } = await sdk.auth.refreshSession({ refresh_token: tokens.refresh_token });
        if (error || !data.session) throw unauthorized();
        tokens = data.session;
        await c.query("update ffu.app_sessions set encrypted_tokens=$2 where token_hash=$1", [digest, sealTokens(tokens, config.encryptionKey)]);
      }
      const user = await verifyUser(sdk, tokens);
      if (user.userId !== row.user_id || user.sessionId !== row.auth_session_id) throw unauthorized();
      return user;
    });
  }
  async function rateLimit(scope, value, maximum, windowSeconds) {
    const key = createHmac("sha256", config.encryptionKey).update(`${scope}:${value}`).digest("hex");
    const count = await db.transaction(async c => {
      const result = await c.query(`insert into ffu.rate_limits(key,count,expires_at) values($1,1,now()+$2*interval '1 second')
        on conflict(key) do update set count=case when ffu.rate_limits.expires_at<=now() then 1 else ffu.rate_limits.count+1 end,
        expires_at=case when ffu.rate_limits.expires_at<=now() then excluded.expires_at else ffu.rate_limits.expires_at end returning count`, [key, windowSeconds]);
      return result.rows[0].count;
    });
    if (count > maximum) throw new Problem(429, "Too many attempts. Wait a few minutes before trying again.");
  }
  async function handle(req, res, path, input) {
    if (path === "/api/auth/session" && req.method === "GET") {
      try { const user = await requireUser(req); return { authenticated: true, email: user.email }; }
      catch (error) { if (error.status === 401) return { authenticated: false }; throw error; }
    }
    if (req.method !== "POST") throw new Problem(404, "This page could not be found.");
    if (req.headers.origin !== origin || req.headers["sec-fetch-site"] === "cross-site") throw new Problem(403, "Submit this request from Film For Us.");
    if (path === "/api/auth/logout") {
      const digest = tokenHash(req);
      if (digest) await db.transaction(async c => {
        const { rows: [row] } = await c.query("delete from ffu.app_sessions where token_hash=$1 returning *", [digest]);
        if (row) {
          // Use Auth's supported logout endpoint; do not implement token revocation.
          const tokens = openTokens(row.encrypted_tokens, config.encryptionKey);
          const { error } = await client().auth.admin.signOut(tokens.access_token, "local");
          if (error && error.status !== 401 && error.status !== 403 && error.status !== 404) throw new Problem(503, "Sign out could not complete. Please try again.");
        }
      });
      res.setHeader("Set-Cookie", cookie("", 0));
      return { ok: true };
    }
    if (!["/api/auth/otp", "/api/auth/verify"].includes(path)) throw new Problem(404, "This page could not be found.");
    const value = await input();
    const email = typeof value?.email === "string" ? value.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Problem(422, "Enter a valid email address.");
    const ip = req.headers["x-vercel-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown";
    await rateLimit("auth-ip", ip, 30, 900);
    const sdk = client();
    if (path === "/api/auth/otp") {
      await rateLimit("otp-cooldown", email, 1, 60);
      await rateLimit("otp-email", email, 6, 3600);
      const { error } = await sdk.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new Problem(error.status === 429 ? 429 : 503, "The verification email could not be sent. Wait a minute and try again.");
      return { ok: true, cooldown: 60 };
    }
    await rateLimit("verify-email", email, 8, 900);
    if (!/^\d{6}$/.test(value?.code ?? "")) throw new Problem(422, "Enter the six-digit verification code.");
    const { data, error } = await sdk.auth.verifyOtp({ email, token: value.code, type: "email" });
    if (error || !data.session) throw new Problem(401, "The code is invalid or expired. Request a new code and try again.");
    const user = await verifyUser(sdk, data.session), token = randomBytes(32).toString("hex");
    await db.transaction(async c => {
      if (!await sessionAlive(c, user.userId, user.sessionId)) throw unauthorized();
      await c.query("insert into ffu.profiles(id) values($1) on conflict(id) do nothing", [user.userId]);
      await c.query("insert into ffu.app_sessions(token_hash,user_id,auth_session_id,encrypted_tokens,expires_at) values($1,$2,$3,$4,now()+$5*interval '1 second')", [hash(token), user.userId, user.sessionId, sealTokens(data.session, config.encryptionKey), lifetime]);
    });
    res.setHeader("Set-Cookie", cookie(token, lifetime));
    return { ok: true };
  }
  return { requireUser, rateLimit, handle };
}
