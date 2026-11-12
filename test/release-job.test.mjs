import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('operator builds are inert by default and reject non-production targets before touching storage',()=>{
  const base={PATH:process.env.PATH,LEGACY_ADMIN_PASSWORD:'synthetic-password-must-never-log'};
  const ordinary=spawnSync(process.execPath,['scripts/release-job.mjs'],{env:base,encoding:'utf8'});
  assert.equal(ordinary.status,0);assert.equal(ordinary.stdout,'');
  for(const job of ['verify-owner','migrate']) {
    const rejected=spawnSync(process.execPath,['scripts/release-job.mjs'],{env:{...base,PHASE4_RELEASE_JOB:job,VERCEL_ENV:'preview',SUPABASE_PRODUCTION_REF:'lppysxtcvuphvynrvtyr'},encoding:'utf8'});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/stopped at configuration/);assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes(base.LEGACY_ADMIN_PASSWORD));
  }
});
