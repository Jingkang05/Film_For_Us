import assert from 'node:assert/strict';
import test from 'node:test';
import { compile } from './support/memory-model.mjs';
const { prepareUpload, isHeifContent } = await import(`data:text/javascript;base64,${Buffer.from(await compile('heic-upload')).toString('base64')}`);
const header = brand => { const b = Buffer.alloc(24); b.writeUInt32BE(24); b.write('ftyp',4); b.write(brand,8); return b; };
const jpeg = () => new Blob([Buffer.from([255,216,255,1])], {type:'image/jpeg'});
test('HEIF detection checks ftyp boundaries and compatible brands, not MIME/extensions', () => {
 assert.ok(isHeifContent(header('heic'))); assert.ok(isHeifContent(header('mif1')));
 const compatible=header('xxxx');compatible.write('heix',16);assert.ok(isHeifContent(compatible));
 assert.equal(isHeifContent(Buffer.from('fake.heic')),false);
 const truncated=header('heic');truncated.writeUInt32BE(1000);assert.equal(isHeifContent(truncated),false);
 assert.equal(isHeifContent(header('avif')),false);
});
test('MIME-less and mislabeled HEIF converts to correctly named JPEG; ordinary files stay identical',async()=>{
 for(const type of ['', 'application/octet-stream','image/jpeg']){
 const f=new File([header('heic')],'iphone.HEIF',{type});let processing=false;
 const out=await prepareUpload(f,()=>processing=true,async()=>jpeg());
 assert.ok(processing);assert.equal(out.name,'iphone.jpg');assert.equal(out.type,'image/jpeg');
 }
 for(const bytes of [Buffer.from([255,216,255]),Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('RIFF0000WEBP')]){
 const f=new File([bytes],'photo.heic'); assert.equal(await prepareUpload(f),f);
 }
});
test('concurrent requests serialize decoding; corrupt conversions recover without poisoning the queue',async()=>{
 let active=0,max=0;const decoder=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return jpeg();};
 const f=new File([header('heic')],'sample.heic');
 await Promise.all(Array.from({length:4},()=>prepareUpload(f,()=>{},decoder)));assert.equal(max,1);
 await assert.rejects(prepareUpload(f,()=>{},async()=>{throw Error('corrupt')}),/could not be converted/);
 await assert.rejects(prepareUpload(f,()=>{},async()=>new Blob(['invalid'],{type:'image/jpeg'})),/could not be converted/);
 await assert.rejects(prepareUpload(new File(['invalid'],'fake.heic')),/not a supported image/);
 assert.equal((await prepareUpload(f,()=>{},decoder)).type,'image/jpeg');
});
