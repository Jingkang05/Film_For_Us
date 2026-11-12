import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { Problem } from "../../server/album.mjs";

export async function postgresFixture() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(n=>n.endsWith(".sql")).sort()) await pg.exec(await readFile(new URL(name,migrations), "utf8"));
  const wrap = tx => ({ query: async (sql, params = []) => {
    const r = await tx.query(sql, params); return { rows: r.rows, rowCount: /^\s*select\b/i.test(sql) ? r.rows.length : r.affectedRows ?? r.rows.length };
  } });
  const db = { pg, close: () => pg.close(), async transaction(work, identity) {
    return pg.transaction(async tx => {
      if (identity) {
        await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: identity.userId, role: "authenticated", session_id: identity.sessionId })]);
        await tx.exec("set local role authenticated");
      }
      try { return await work(wrap(tx)); }
      catch (error) { if (error instanceof Problem) throw error; if (error.code === "23505") throw new Problem(409, "Sharing address collision."); throw error; }
    });
  } };
  return db;
}
