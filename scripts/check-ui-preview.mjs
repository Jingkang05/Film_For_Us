import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
process.env.VERCEL_ENV='preview';
process.env.VERCEL_GIT_COMMIT_REF='codex/phase-4-supabase-multi-user';
const {default: api} = await import('../api/[...route].mjs');
const server=createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')) return api(req,res);
  const path=new URL(req.url,'http://localhost').pathname;
  const file=path.includes('.') ? path : '/index.html';
  try { const data=await readFile(new URL('../public'+file,import.meta.url));
    const ext=file.split('.').pop();res.setHeader('Content-Type',({js:'text/javascript',css:'text/css',html:'text/html',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[ext]??'application/octet-stream');res.end(data);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try {
  assert.equal((await fetch(origin+'/api/auth/session')).status,503);
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[], forbidden=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/')||!r.url().startsWith(origin))forbidden.push(r.url());});
  await mkdir('.data/ui-preview-qa',{recursive:true});
  const cases=[['demo','/demo','.demo-opening-invitation a'],['login','/login','form'],['create','/create','.template-choice'],['studio','/dashboard','.album-row'],['editor','/editor/DEMO000000000001','[data-action="save"]'],['sidebar','/a/ui-sample?sidebar=1','.viewer-menu[open]']];
  for(const [name,path,selector] of cases) {
    await page.goto(origin+path);await page.locator(selector).waitFor();
    await page.screenshot({path:`.data/ui-preview-qa/${name}.png`});
  }
  await page.goto(origin+'/login');await page.locator('[name=email]').fill('sample@example.test');await page.locator('[type=submit]').click();await page.locator('[name=code]').fill('12345678');await page.locator('[type=submit]').click();await page.waitForURL('**/dashboard');
  await page.goto(origin+'/create');await page.locator('.template-choice button').click();await page.waitForURL('**/editor/DEMO000000000001');await page.locator('[data-action=save]').click();
  assert.equal(await page.evaluate(async()=> (await fetch('/api/a/private-album')).status),403);
  assert.equal(await page.evaluate(async()=>{try {await fetch('https://example.com');return false;}catch{return true;}}),true);
  await page.evaluate(()=>localStorage.setItem('temporary','yes'));await page.reload();assert.equal(await page.evaluate(()=>localStorage.getItem('temporary')),null);
  await page.setViewportSize({width:390,height:844});
  for(const [name,path,selector] of cases) {await page.goto(origin+path);await page.locator(selector).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`.data/ui-preview-qa/mobile-${name}.png`});}
  assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
  console.log('PASS: five interfaces desktop/mobile, login/create/save, reset, blocked private/external requests, backend 503; zero API or external network requests.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
