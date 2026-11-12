import test from 'node:test';
import {execFileSync} from 'node:child_process';

test('authentication staging denies album access before loading any storage; Preview remains isolated',()=>{
  for(const environment of ['production','preview']) {
    const script = `
      const {default:route}=await import('./api/[...route].mjs');
      for(const [method,url] of [['GET','/api/editor'],['GET','/api/a/ruoxue'],['PUT','/api/editor/AAAAAAAAAAAAAAAA/upload'],['POST','/api/editor/create'],['POST','/api/release-preflight']]) {
        let status,body; const res={setHeader(){},writeHead(s){status=s;},end(b){body=b;}};
        await route({method,url},res);
        if(status!==503 || !JSON.parse(body).error) throw Error('Staging allowed album access');
      }`;
    execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{PATH:process.env.PATH,VERCEL_ENV:environment,PHASE4_AUTH_STAGING:'true',VERCEL_GIT_COMMIT_REF:'codex/phase-4-supabase-multi-user'},stdio:'pipe'});
  }
});
