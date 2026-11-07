// PREVIEW ONLY: translate copies of served responses in memory.
// No writes to src/, public/, the album, or the live application's configuration.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const upstream = 'http://127.0.0.1:4187';
const copy = JSON.parse(await readFile(new URL('./copy.json', import.meta.url), 'utf8'));
const translatedModules = new Set(['/ui/envelope-config.js', '/ui/darkroom.js', '/ui/polaroid-config.js']);
const pairs = Object.entries(copy).sort((a,b) => b[0].length-a[0].length);
const styles = '\n/* Chinese prompt preview only. */\n.stage-hint {font-size:clamp(1.3rem,2.1vw,1.75rem);line-height:1.4;letter-spacing:.06em;text-wrap:balance;}\n';

createServer(async (req,res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end('Preview only'); return; }
  try {
    const route = new URL(req.url, 'http://127.0.0.1:4189');
    const path = route.pathname === '/' ? '/demo' : route.pathname;
    const response = await fetch(upstream + path + route.search);
    const headers = Object.fromEntries(['content-type','content-security-policy','x-content-type-options','referrer-policy']
      .filter(key=>response.headers.has(key)).map(key=>[key,response.headers.get(key)]));
    headers['cache-control']='no-store';
    res.writeHead(response.status,headers);
    if (req.method==='HEAD') {res.end();return;}
    if (translatedModules.has(path)) {
      let source = await response.text();
      for(const [english,chinese] of pairs) source=source.replaceAll(english,chinese);
      res.end(source);
    } else if(path==='/envelope.css') res.end(await response.text()+styles);
    else if(response.headers.get('content-type')?.startsWith('text/html')) {
      res.end((await response.text()).replace('<html lang="en">','<html lang="zh-Hans">')
        .replace('<title>Roll for us · Darkroom</title>','<title>Roll for us · 中文提示预览</title>'));
    } else res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(502,{'content-type':'text/plain;charset=utf-8'});
    res.end('Preview requires the existing local app on port 4187.');
  }
}).listen(4189,'127.0.0.1',()=>console.log('Chinese prompt preview only · http://127.0.0.1:4189'));
