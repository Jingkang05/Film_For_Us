import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
// Pinned dependency, hosted locally; never fetched from a CDN at runtime.
await mkdir('public/ui', { recursive: true });
const source = await readFile('node_modules/heic-to/dist/csp/heic-to.js', 'utf8');
// Bound allocation before libheif creates the RGBA output, matching the server's
// 50 MP limit. Fail the build if the pinned upstream implementation changes.
const allocation = /new ImageData\(([\w$]+),([\w$]+)\)/g;
if ([...source.matchAll(allocation)].length !== 1) throw new Error('Review HEIC decoder allocation guard before updating.');
const guarded = source.replace(allocation, (_, w, h) => `(${w}>0&&${h}>0&&${w}*${h}<=50000000?new ImageData(${w},${h}):(()=>{throw new Error(50000000)})())`);
await writeFile('public/ui/heic-decoder.js', guarded);
await copyFile('node_modules/heic-to/LICENSE', 'public/ui/heic-decoder-license.txt');
