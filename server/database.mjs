import pg from "pg";
import { Problem } from "./album.mjs";

export function openDatabase(config) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: true }, allowExitOnIdle: true });
  pool.on("error", () => console.error("Database connection failed."));
  return {
    pool,
    async transaction(work, identity) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local statement_timeout = '12s'");
        await client.query("set local lock_timeout = '5s'");
        if (identity) {
          await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: identity.userId, role: "authenticated", session_id: identity.sessionId })]);
          await client.query("set local role authenticated");
        }
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        if (error instanceof Problem) throw error;
        if (error.code === "23505") throw new Problem(409, "This sharing address is already reserved by another album. Choose another suffix.");
        if (["40001", "40P01", "55P03"].includes(error.code)) throw new Problem(409, "The album changed or is busy. Reload and try again.");
        // Driver errors can include connection parameters or private SQL values.
        throw new Problem(503, "The database is temporarily unavailable. No unverified changes were accepted.");
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
