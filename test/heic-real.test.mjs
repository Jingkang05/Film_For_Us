import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveObjectURL} from 'node:buffer';
import {Worker as NodeWorker} from 'node:worker_threads';
import sharp from 'sharp';
// Execute the shipped CSP decoder in a real isolated thread. Only browser canvas
// encoding is substituted with Sharp; decoding runs the actual libheif worker.
test('real HEIC primary image decodes through the CSP worker and re-encodes JPEG',async()=>{
 const workers=[];
 const previous={Worker:globalThis.Worker,document:globalThis.document};
 globalThis.Worker=class {
  constructor(url){this.listeners={};this.ready=resolveObjectURL(url).text().then(source=>{
   const prefix=`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.onmessage=null;globalThis.postMessage=x=>parentPort.postMessage(x);globalThis.ImageData=class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4)}};globalThis.process=undefined;`;
   const w=new NodeWorker(prefix+source+`;parentPort.on('message',data=>onmessage({data}));`,{eval:true});workers.push(w);
   w.on('message',data=>(this.listeners.message??[]).slice().forEach(fn=>fn({data,currentTarget:this})));
   w.on('error',error=>(this.listeners.error??[]).slice().forEach(fn=>fn({data:error,currentTarget:this})));return w;
  });}
  postMessage(data){this.ready.then(w=>w.postMessage(data));}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]??[]).filter(f=>f!==fn);}
 };
 globalThis.document={createElement:()=>{let pixels;return {width:0,height:0,getContext:()=>({putImageData:data=>pixels=data,clearRect:()=>{}}),toBlob(callback,type,quality){sharp(Buffer.from(pixels.data),{raw:{width:pixels.width,height:pixels.height,channels:4}}).jpeg({quality:Math.round(quality*100)}).toBuffer().then(bytes=>callback(new Blob([bytes],{type})));}};}};
 try{
 const {heicTo}=await import('../public/ui/heic-decoder.js');
 for (const [name,width,height] of [['example.heic',1280,854],['high-resolution.heic',6000,8000]]) {
 const source=await readFile(new URL('./fixtures/heic/'+name,import.meta.url));
 await assert.rejects(sharp(source).jpeg().toBuffer()); // mirrors the default prebuilt production codec limitation
 const jpeg=await heicTo({blob:new Blob([source]),type:'image/jpeg',quality:.92});
 const metadata=await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata();
 assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,width);assert.equal(metadata.height,height);
 }
 await assert.rejects(heicTo({blob:new Blob(['corrupt HEIC']),type:'image/jpeg',quality:.92}));
 }finally{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);}
});
