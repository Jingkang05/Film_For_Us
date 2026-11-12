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
      const checks = {configuration:false,database:false,rls:false,auth:false};
      try {
        const {platformConfig} = await import('../server/platform-config.mjs');
        const {openDatabase} = await import('../server/database.mjs');
        const config = platformConfig(process.env);
        checks.configuration = true;
        db = openDatabase(config);
        const {rows:[r]} = await db.pool.query("select count(*)::int as tables, bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT')) as protected from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ffu' and c.relkind='r'");
        checks.database = true;
        checks.rls = r.tables === 8 && r.protected === true;
        const auth = await fetch(`${config.url}/auth/v1/health`, {headers:{apikey:config.publishableKey}, signal:AbortSignal.timeout(8000)});
        checks.auth = auth.ok;
        if (!checks.rls || !checks.auth) throw new Error('Preflight failed');
        res.writeHead(200, {'Content-Type':'application/json'});res.end(JSON.stringify(checks));
      } catch (error) {
        const safeCodes = ['28P01','3D000','53300','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ECONNREFUSED','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED'];
        const failure = safeCodes.includes(error.code) ? error.code : !checks.configuration ? 'configuration' : !checks.database ? 'database' : !checks.rls ? 'rls' : 'auth';
        res.writeHead(503, {'Content-Type':'application/json'});res.end(JSON.stringify({...checks,failure}));
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
