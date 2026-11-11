// Local-only decoder smoke page, with the app's worker CSP. No album/Blob access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const html = `<!doctype html><meta name="viewport" content="width=device-width"><title>HEIC local check</title><h1>HEIC local check</h1><p>Public fixture only; no upload service.</p><button>Convert public HEIC fixture</button><p role="status">Ready</p><img alt="Converted fixture"><script type="module" src="/check.js"></script>`;
const js = `import {prepareUpload} from '/ui/heic-upload.js';const status=document.querySelector('[role=status]');document.querySelector('button').onclick=async()=>{try{const bytes=await(await fetch('/fixture.heic')).blob();const file=await prepareUpload(new File([bytes],'sample.heic'),()=>status.textContent='Converting');const image=document.querySelector('img');image.src=URL.createObjectURL(file);await image.decode();status.textContent='PASS: '+file.name+' '+file.type+' '+image.naturalWidth+'×'+image.naturalHeight;}catch(e){status.textContent='FAIL: '+e.message}};`;
createServer(async(req,res)=>{try{
 let data,type='text/javascript';
 if(req.url==='/'){data=html;type='text/html';}
 else if(req.url==='/check.js')data=js;
 else if(req.url==='/fixture.heic'){data=await readFile(new URL('../test/fixtures/heic/example.heic',import.meta.url));type='application/octet-stream';}
 else if(/^\/ui\/[a-z-]+\.js$/.test(req.url))data=await readFile(new URL('../public'+req.url,import.meta.url));
 else {res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':type,'Content-Security-Policy':"default-src 'self'; worker-src 'self' blob:; img-src 'self' blob:"});res.end(data);
}catch{res.writeHead(500);res.end('Failed');}}).listen(4184,'127.0.0.1',()=>console.log('HEIC browser check http://127.0.0.1:4184'));
