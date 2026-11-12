// Explicit Production operator build job. Ordinary builds perform no I/O here.
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {platformConfig} from '../server/platform-config.mjs';
import {openDatabase} from '../server/database.mjs';
import {r2Config,createR2Storage} from '../server/r2-storage.mjs';
import {openR2Album} from '../server/r2-album.mjs';
import {readBytes,StorageConflict} from '../server/object-storage.mjs';
import {verifyLegacyAdministrator,migrationRows} from './migrate-to-postgres.mjs';

let operatorPhase='configuration';
async function run() {
  const job=process.env.PHASE4_RELEASE_JOB;
  if(!job)return;
  if(!['verify-owner','migrate'].includes(job) || process.env.VERCEL_ENV!=='production' || process.env.SUPABASE_PRODUCTION_REF!=='lppysxtcvuphvynrvtyr')throw Error('Operator target rejected');
  const config=platformConfig(),db=openDatabase(config),objects=createR2Storage(r2Config());
  try {
    const state=await openR2Album(objects).exportState();
    operatorPhase='legacy-administrator-proof';
    verifyLegacyAdministrator(state,process.env.LEGACY_ADMIN_PASSWORD);
    if(!process.env.MIGRATION_OWNER_ID || !process.env.MIGRATION_OWNER_EMAIL)throw Error('Explicit owner required');
    operatorPhase='verified-otp-owner';
    const verified=await db.transaction(async c=>{
      const {rows:[r]}=await c.query("select u.email_confirmed_at is not null and lower(u.email)=lower($2) and exists(select 1 from ffu.app_sessions a join auth.sessions s on s.id=a.auth_session_id and s.user_id=a.user_id where a.user_id=u.id and a.expires_at>now() and (s.not_after is null or s.not_after>now())) as verified from auth.users u where u.id=$1",[process.env.MIGRATION_OWNER_ID,process.env.MIGRATION_OWNER_EMAIL]);
      return r?.verified===true;
    });
    if(!verified)throw Error('Verified OTP owner required');
    console.log(JSON.stringify({operatorJob:job,legacyAdministratorVerified:true,activeOtpSessionVerified:true,legacyAlbums:migrationRows(state).length}));
    if(job==='verify-owner')return;
    if(process.env.STORAGE_WRITE_FREEZE!=='true'||process.env.MIGRATION_FREEZE_CONFIRMED!=='true')throw Error('Live freeze confirmation required');
    const file=`.data/phase4/operator-${randomUUID()}.json`;
    for(const command of ['export','import','verify']) {
      operatorPhase=`migration-${command}`;
      const output=execFileSync(process.execPath,['scripts/migrate-to-postgres.mjs',command,file],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
      const report=JSON.parse(output);console.log(JSON.stringify({migrationStep:command,...report}));
      if(command==='export') {
        const bytes=await readFile(`${file}.manifest.json`),manifest=JSON.parse(bytes),key=`${manifest.backupKey}.manifest.json`;
        try {await objects.put(key,bytes,{createOnly:true,contentType:'application/json'});}catch(e){if(!(e instanceof StorageConflict))throw e;}
        const stored=JSON.parse(await readBytes(await objects.read(key)));
        if(stored.digest!==manifest.digest||stored.byteSha256!==manifest.byteSha256)throw Error('Private backup manifest mismatch');
        console.log(JSON.stringify({privateBackupManifestVerified:true,backupKey:manifest.backupKey}));
      }
    }
  } finally {await db.close();}
}
await run().catch(()=>{console.error(`Release operator job stopped at ${operatorPhase}. No credentials logged. Keep the live provider and freeze unchanged until the failure is resolved.`);process.exitCode=1;});
