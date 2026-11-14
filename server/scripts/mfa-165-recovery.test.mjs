import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPackage, verifyPackage, applicationReleaseSpec } from './migration-package.mjs';
import { checkRecoveryHistory, failedAttempt, assertNoMfaObjects, syntheticRecoveryConnection } from './mfa-165-recovery.mjs';
import { runApplicationReleasePreflight } from './application-release-preflight.mjs';

test('recovery package pins only the observed failed attempt and unchanged SQL',()=>{
  const bundle=buildPackage('HEAD');
  const release=applicationReleaseSpec(verifyPackage(bundle));
  assert.equal(release.status,'approved-for-production');
  const prior=buildPackage('edabf1aa2c5669eb7188afdc5f0f890308ece52e');
  const sql=`server/prisma/migrations/${failedAttempt.name}/migration.sql`;
  assert.deepEqual(verifyPackage(bundle).get(sql),verifyPackage(prior).get(sql));
  const historical=release.historicalRolledBackRows.map(r=>({id:r.id,migration_name:r.name,checksum:r.checksum,finished_at:null,rolled_back_at:new Date(0)}));
  const active=bundle.files.filter(f=>/migrations\/[^/]+\/migration.sql$/.test(f.path) && !f.path.includes(failedAttempt.name))
    .map((f,i)=>({id:`active-${i}`,migration_name:f.path.split('/').at(-2),checksum:f.sha256,finished_at:new Date(0),rolled_back_at:null}));
  const exceptions=JSON.parse(verifyPackage(bundle).get('server/security/staffMigrationReconciliation.v2.json')).exceptions;
  for(const r of active) if(exceptions[r.migration_name]) r.checksum=exceptions[r.migration_name].recordedChecksum;
  const failed=historical.at(-1); failed.rolled_back_at=null;
  const rows=[...active,...historical];
  assert.deepEqual(checkRecoveryHistory(bundle,rows,release.target,'failed'),[failedAttempt.name]);
  assert.equal(failed.rolled_back_at,null,'validation never mutates actual ledger');
  for(const patch of [{id:'unknown'},{checksum:'0'.repeat(64)},{finished_at:new Date()},{rolled_back_at:new Date()}]) {
    assert.throws(()=>checkRecoveryHistory(bundle,rows.map(r=>r===failed?{...r,...patch}:r),release.target,'failed'));
  }
  const resolved=rows.map(r=>r===failed?{...r,rolled_back_at:new Date()}:r);
  assert.deepEqual(checkRecoveryHistory(bundle,resolved,release.target,'resolved'),[failedAttempt.name]);
  assert.throws(()=>checkRecoveryHistory(bundle,resolved,release.target,'complete'));
  assert.deepEqual(checkRecoveryHistory(bundle,[...resolved,{id:'new-success',migration_name:failedAttempt.name,checksum:failedAttempt.checksum,finished_at:new Date(),rolled_back_at:null}],release.target,'complete'),[]);
});

test('partial MFA objects are a hard stop',async()=>{
  await assertNoMfaObjects({$queryRawUnsafe:async()=>[{tables:0,functions:0}]});
  for(const value of [{tables:1,functions:0},{tables:0,functions:1}])
    await assert.rejects(assertNoMfaObjects({$queryRawUnsafe:async()=>[value]}));
});

test('preflight rejects non-inheriting managed executor before migration',async()=>{
  const bundle=buildPackage('edabf1aa2c5669eb7188afdc5f0f890308ece52e');
  let calls=0;
  const db={$transaction:async fn=>fn({$executeRawUnsafe:async()=>{},$queryRawUnsafe:async()=>{
    if(++calls===1)return [{database:'defaultdb',role:'doadmin'}];
    return [{usage:false,create:false,can_set_owner:true,runtime_member:false}];
  }})};
  await assert.rejects(runApplicationReleasePreflight(db,bundle,'before',{databaseUrl:'postgresql://doadmin@chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb'}),/lacks protected-schema/);
  assert.equal(calls,2);
});


test('synthetic recovery cannot target production or run outside explicit PR rehearsal',()=>{
  const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:'nortonjulian/chatforia',APPLICATION_RELEASE_SYNTHETIC_PG18:'yes',DATABASE_URL:'postgresql://doadmin:test@127.0.0.1:5432/chatforia_application_release_test'};
  assert.equal(syntheticRecoveryConnection(env).hostname,'127.0.0.1');
  for(const change of [
    {DATABASE_URL:'postgresql://doadmin:test@chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb'},
    {DATABASE_URL:'postgresql://doadmin:test@127.0.0.1:5432/defaultdb'},
    {DATABASE_URL:env.DATABASE_URL+'?host=production'},
    {GITHUB_ACTIONS:'false'}, {GITHUB_EVENT_NAME:'workflow_dispatch'},
    {APPLICATION_RELEASE_SYNTHETIC_PG18:'no'}, {DIRECT_URL:'postgresql://production'},
  ]) assert.throws(()=>syntheticRecoveryConnection({...env,...change}));
});
