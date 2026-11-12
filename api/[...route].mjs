// Gate before loading storage: UI demonstrations have no backend or credentials.
const demonstration = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'codex/phase-4-supabase-multi-user';
let handler;
export default async function route(req, res) {
  if (demonstration) {
    res.writeHead(503, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Isolated UI demonstration: backend access disabled.'}));
    return;
  }
  if (!handler) {
    const [{openStorage}, {createHandler}] = await Promise.all([import('../server/storage.mjs'), import('../server/index.mjs')]);
    const origin = new URL(process.env.APP_ORIGIN ?? `https://${process.env.VERCEL_URL}`).origin;
    handler = createHandler({data:openStorage(), origin, password:process.env.OWNER_PASSWORD, allowStoredOwner:true, writeFreeze:process.env.STORAGE_WRITE_FREEZE==='true'});
  }
  return handler(req,res);
}
