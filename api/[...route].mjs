// Gate before loading storage: UI demonstrations have no backend or credentials.
const demonstration = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'codex/phase-4-supabase-multi-user';
const authStaging = process.env.VERCEL_ENV === 'production' && process.env.PHASE4_AUTH_STAGING === 'true';
let handler;
export default async function route(req, res) {
  if (demonstration) {
    res.writeHead(503, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Isolated UI demonstration: backend access disabled.'}));
    return;
  }
  const path = new URL(req.url, 'https://localhost').pathname;
  if (authStaging) {
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/api/release-preflight' && req.method === 'GET') {
      let db;
      try {
        const {platformConfig} = await import('../server/platform-config.mjs');
        const {openDatabase} = await import('../server/database.mjs');
        const config = platformConfig(process.env);
        db = openDatabase(config);
        const verified = await db.transaction(async c => {
          const {rows:[r]} = await c.query("select count(*)::int as tables, bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT')) as protected from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ffu' and c.relkind='r'");
          return r.tables === 8 && r.protected === true;
        });
        const auth = await fetch(`${config.url}/auth/v1/health`, {headers:{apikey:config.publishableKey}, signal:AbortSignal.timeout(8000)});
        if (!verified || !auth.ok) throw new Error('Preflight failed');
        res.writeHead(200, {'Content-Type':'application/json'});res.end(JSON.stringify({configuration:true,database:true,rls:true,auth:true}));
      } catch {
        res.writeHead(503, {'Content-Type':'application/json'});res.end(JSON.stringify({verified:false}));
      } finally {await db?.close();}
      return;
    }
    if (!path.startsWith('/api/auth/') && !['/api/platform','/api/demo'].includes(path)) {
      res.writeHead(503, {'Content-Type':'application/json'});res.end(JSON.stringify({error:'Album access is disabled on this authentication staging deployment.'}));return;
    }
  }
  if (!handler) {
    const [{openStorage}, {createHandler}] = await Promise.all([import('../server/storage.mjs'), import('../server/index.mjs')]);
    const origin = new URL(authStaging ? `https://${process.env.VERCEL_URL}` : process.env.APP_ORIGIN ?? `https://${process.env.VERCEL_URL}`).origin;
    const env = {...process.env, APP_ORIGIN:origin};
    handler = createHandler({data:openStorage(env), origin, password:process.env.OWNER_PASSWORD, allowStoredOwner:true, writeFreeze:process.env.STORAGE_WRITE_FREEZE==='true'});
  }
  return handler(req,res);
}
