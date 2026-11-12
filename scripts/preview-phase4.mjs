// Disposable local QA only: embedded PostgreSQL + synthetic Auth + memory R2.
// No .data reads, external requests, production credentials, or hosted writes.
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { postgresFixture } from "../test/support/postgres-fixture.mjs";
import { authFixture } from "../test/support/auth-fixture.mjs";
import { objectFixture, stateFixture } from "../test/support/object-fixture.mjs";
import { createPlatformAuth } from "../server/platform-auth.mjs";
import { openPostgresAlbum, persistAlbum } from "../server/postgres-album.mjs";
import { mediaKey } from "../server/r2-album.mjs";
import { createHandler } from "../server/index.mjs";

export async function startPreview(port = 4184) {
  if(process.env.VERCEL) throw new Error("Synthetic authentication must never run on Vercel.");
  const db=await postgresFixture(),objects=objectFixture(),provider=authFixture(db),origin=`http://127.0.0.1:${port}`;
  const config={encryptionKey:randomBytes(32)};
  const auth=createPlatformAuth({db,config,origin,clientFactory:provider.clientFactory});
  const data=openPostgresAlbum({db,objects,auth});
  const owner=randomUUID(), state=stateFixture();
  await db.transaction(async c=>{
    await c.query("insert into auth.users(id,email,email_confirmed_at) values($1,'existing@example.test',now())",[owner]);
    await c.query("insert into ffu.profiles(id) values($1)",[owner]);
    await persistAlbum(c,state.album,owner,{insert:true,uploaded:state.uploaded});
  });
  const content=JSON.parse(state.album.draft);
  for(const [i,roll] of content.rolls.entries()) for(const photo of roll.photos) {
    const bytes=await readFile(new URL(`../public/samples/${["rain-1","sea-1","home-1"][i]}.webp`,import.meta.url));
    for(const variant of ["source","thumb","full"]) await objects.put(mediaKey("roll-for-us",state.album,photo.id,variant),bytes);
  }
  const uploads=new Map();
  objects.signUpload=async(key,{contentLength})=>{
    const ticket=randomUUID();uploads.set(ticket,{key,contentLength});
    return {url:`${origin}/qa-upload/${ticket}`,headers:{"Content-Type":"application/octet-stream","If-None-Match":"*"}};
  };
  const handler=createHandler({data,origin});
  const server=createServer(async(req,res)=>{
    if(req.url?.startsWith("/qa-upload/") && req.method==="PUT") {
      const upload=uploads.get(req.url.split("/").pop());
      if(!upload || req.headers.origin!==origin) {res.writeHead(403);res.end();return;}
      const chunks=[];for await(const chunk of req) chunks.push(chunk);const bytes=Buffer.concat(chunks);
      if(bytes.length!==upload.contentLength) {res.writeHead(413);res.end();return;}
      await objects.put(upload.key,bytes,{createOnly:true});uploads.delete(req.url.split("/").pop());res.writeHead(200);res.end();return;
    }
    await handler(req,res);
  });
  server.listen(port,"127.0.0.1");await once(server,"listening");
  return {origin,db,data,objects,provider,server,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const preview=await startPreview(); console.log(`Disposable Phase 4 QA: ${preview.origin} — synthetic OTP 12345678; existing@example.test owns a sample publication.`);
  process.once("SIGINT",async()=>{await preview.close();process.exit(0);});
}
