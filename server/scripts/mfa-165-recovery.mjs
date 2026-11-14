import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { readPackage, verifyPackage, applicationReleaseSpec, checkReconciledHistory } from './migration-package.mjs';
import { ledger, aggregateChecks, assertChecks } from './deploy-migration-package.mjs';
import { checksForPending } from './migration-package.mjs';
import { runApplicationReleasePreflight } from './application-release-preflight.mjs';
import { runRecoveryChild, recoveryConnection } from './staff-stage5-recovery-run.mjs';
import { runRecoverySequence } from './staff-stage5-recovery-sequence.mjs';

export const failedAttempt = Object.freeze({
  id: 'e85fbfdb-a6e6-4a11-8035-09b0131ed9fd',
  name: '20261114050000_authorized_mfa_disable',
  checksum: '9c2b5bb518becc5dec7a994b3c5e568377c67fc6c5a84e212e3a87f3358d73fa',
});

export function checkRecoveryHistory(bundle, rows, target, phase) {
  assert.ok(['failed', 'resolved', 'complete'].includes(phase));
  const release = applicationReleaseSpec(verifyPackage(bundle));
  assert.equal(release.historicalRolledBackCount, 5);
  assert.deepEqual(release.historicalRolledBackRows.at(-1), failedAttempt);
  const matching = rows.filter(r => r.id === failedAttempt.id);
  assert.equal(matching.length, 1);
  const row = matching[0];
  assert.equal(row.migration_name, failedAttempt.name);
  assert.equal(row.checksum, failedAttempt.checksum);
  assert.equal(row.finished_at, null);
  if (phase === 'failed') {
    assert.equal(row.rolled_back_at, null);
    // Model only the expected resolution IN MEMORY to validate the full baseline.
    // No ledger SQL update or checksum rewriting is permitted.
    rows = rows.map(r => r === row ? {...r, rolled_back_at: new Date(0)} : r);
  } else assert.ok(row.rolled_back_at);
  return checkReconciledHistory(bundle, rows, target, phase === 'complete');
}

export async function checkRecoveryRole(db, inherited, database = 'defaultdb') {
  const [p] = await db.$queryRawUnsafe(`SELECT current_user, session_user,
    current_database() AS database,
    has_schema_privilege(current_user,'staff_security','USAGE') AS usage,
    has_schema_privilege(current_user,'staff_security','CREATE') AS create,
    pg_has_role(current_user,'chatforia_staff_owner','SET') AS can_set,
    pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER') AS runtime_member,
    (SELECT r.rolname FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
      WHERE n.nspname='staff_security') AS owner`);
  assert.equal(p.current_user, 'doadmin'); assert.equal(p.session_user, 'doadmin');
  assert.equal(p.database, database); assert.equal(p.owner, 'chatforia_staff_owner');
  assert.equal(p.usage, inherited); assert.equal(p.create, inherited);
  assert.equal(p.can_set, true); assert.equal(p.runtime_member, false);
  const rows = await db.$queryRawUnsafe(`SELECT g.rolname AS grantor,
    m.admin_option, m.inherit_option, m.set_option
    FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
    JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor
    WHERE r.rolname='chatforia_staff_owner' AND u.rolname='doadmin'
    ORDER BY g.rolname`);
  assert.deepEqual(rows, [
    {grantor:'doadmin',admin_option:false,inherit_option:inherited,set_option:true},
    {grantor:'postgres',admin_option:true,inherit_option:false,set_option:false},
  ]);
}

export async function assertNoMfaObjects(db) {
  const [r] = await db.$queryRawUnsafe(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='staff_security' AND c.relname IN ('mfa_disable_event','mfa_enrollment_event')) AS tables,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='staff_security' AND p.proname IN ('disable_mfa','enroll_mfa')) AS functions`);
  assert.deepEqual(r, {tables:0,functions:0});
}

export function syntheticRecoveryConnection(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request');
  assert.equal(env.GITHUB_REPOSITORY, 'nortonjulian/chatforia');
  assert.equal(env.APPLICATION_RELEASE_SYNTHETIC_PG18, 'yes');
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/chatforia_application_release_test');
  assert.equal(url.username, 'doadmin');
  assert.ok(!env.DIRECT_URL && !env.SHADOW_DATABASE_URL);
  assert.ok(!url.searchParams.has('host'));
  return url;
}

export async function recover(options, testOptions = {}) {
  const bundle = readPackage(options.package, options.sha256);
  const files = verifyPackage(bundle);
  const release = applicationReleaseSpec(files);
  assert.equal(release.historicalRolledBackCount, 5);
  assert.deepEqual(release.historicalRolledBackRows.at(-1), failedAttempt);
  // This programmatic-only test path cannot target a public/private production
  // hostname and is never exposed by the CLI. Production validation is unchanged.
  const synthetic = testOptions.allowSyntheticForTest === true;
  const url = synthetic ? syntheticRecoveryConnection(process.env) : recoveryConnection(process.env, release).url;
  if (options.execute && !synthetic) assert.equal(release.status, 'approved-for-production', 'Recovery package requires production approval');
  const database = synthetic ? 'chatforia_application_release_test' : 'defaultdb';
  const preflightOptions = synthetic ? {allowProposedForIsolatedTest: true} : {};
  if (testOptions.failureStage) assert.ok(synthetic && ['after-resolve','during-deploy'].includes(testOptions.failureStage));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const archive = realpathSync(options.archive);
  const rel = relative(root, archive);
  assert.ok(rel && (rel.startsWith('..') || isAbsolute(rel)), 'Private archive must be outside checkout');
  const receiptDir = join(archive, `mfa-recovery-${bundle.commit}-${randomUUID()}`);
  mkdirSync(receiptDir, {mode:0o700});
  writeFileSync(join(receiptDir,'package.json'), readFileSync(options.package), {flag:'wx',mode:0o600});
  const work = mkdtempSync(join(tmpdir(),'mfa-recovery-'));
  const db = new PrismaClient({log:[],datasources:{db:{url:url.toString()}}});
  let interrupted = false;
  const interrupt = () => {interrupted = true;};
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  let index = 0;
  const record = (stage, value) => writeFileSync(join(receiptDir,`${++index}-${stage}.json`),
    JSON.stringify({stage,at:new Date().toISOString(),value},null,2)+'\n',{flag:'wx',mode:0o600});
  const checks = checksForPending(files,[failedAttempt.name]);
  let before;
  const gate = async (phase, inherited) => {
    await checkRecoveryRole(db,inherited,database);
    const rows = await ledger(db);
    checkRecoveryHistory(bundle,rows,release.target,phase);
    if (phase !== 'complete') await assertNoMfaObjects(db);
    const values = await aggregateChecks(db,checks);
    if (phase === 'failed') {assertChecks(checks,values); before=values;}
    else if (phase === 'complete') {
      assertChecks(checks,before,values);

    } else assertChecks(checks,values);
    record(phase,{ledger:rows,checks:values});
  };
  try {
    await gate('failed',false);
    const [failure] = await db.$queryRawUnsafe(`SELECT applied_steps_count, logs
      FROM public._prisma_migrations WHERE id=$1`,failedAttempt.id);
    assert.equal(failure.applied_steps_count,0);
    assert.match(failure.logs,/permission denied for schema staff_security/);
    if (!options.execute) {
      console.log(`Recovery preflight passed. Private receipt: ${receiptDir}`);
      return;
    }
    for (const [path,bytes] of files) {
      const dest=join(work,path); mkdirSync(dirname(dest),{recursive:true,mode:0o700});
      writeFileSync(dest,bytes,{flag:'wx',mode:0o400});
    }
    const prisma=join(root,'node_modules/prisma');
    assert.equal(JSON.parse(readFileSync(join(prisma,'package.json'))).version,
      JSON.parse(files.get('package-lock.json')).packages['node_modules/prisma'].version);
    const migrate=(...args)=>runRecoveryChild(process.execPath,[join(prisma,'build/index.js'),
      'migrate',...args,'--schema',join(work,'server/prisma/schema.prisma')],
      {cwd:work,env:{...process.env,DATABASE_URL:url.toString(),PRISMA_HIDE_UPDATE_MESSAGE:'true'},timeout:600000});
    await db.$transaction(async guard => {
    const [lock] = await guard.$queryRawUnsafe("SELECT pg_try_advisory_xact_lock(73421,300) AS acquired");
    assert.equal(lock.acquired,true, "Another migration operator is active");
    await runRecoverySequence({
      failed:async()=>gate('failed',false),
      beforeEnable:async()=>{},
      enable:async()=>{
        await db.$transaction(async tx=>{
          await checkRecoveryRole(tx,false,database);
          await assertNoMfaObjects(tx);
          const [sessions] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS other_sessions
            FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user
              AND pid<>pg_backend_pid() AND backend_type='client backend'`);
          assert.equal(sessions.other_sessions,1,'Unexpected DBA session; fence other operator sessions');
          await tx.$executeRawUnsafe('GRANT chatforia_staff_owner TO doadmin WITH SET TRUE, INHERIT TRUE, ADMIN FALSE');
          await checkRecoveryRole(tx,true,database);
        }); record('inherit-enabled',true);
      },
      resolve:async()=>migrate('resolve','--rolled-back',failedAttempt.name),
      resolved:async()=>{
        await gate('resolved',true);
        if (testOptions.failureStage === 'after-resolve') throw new Error('Synthetic failure after resolve');
      },
      beforeDeploy:async()=>runApplicationReleasePreflight(db,bundle,'before',preflightOptions),
      deploy:async()=>{
        if (testOptions.failureStage === 'during-deploy') {
          // Disposable test only: force the real locked Prisma child to fail.
          await db.$executeRawUnsafe('GRANT chatforia_staff_owner TO doadmin WITH INHERIT FALSE');
        }
        await migrate('deploy');
        await runApplicationReleasePreflight(db,bundle,'after',preflightOptions);
        record('post-migration-grants',true);
      },
      disable:async()=>{
        // Commit reduction before diagnostics; no cleanup failure can roll it back.
        await db.$executeRawUnsafe('GRANT chatforia_staff_owner TO doadmin WITH INHERIT FALSE');
        await checkRecoveryRole(db,false,database); record('inherit-disabled',true);
      },
      complete:async()=>gate('complete',false),
    },()=>interrupted);
    }, {timeout:1200000,maxWait:10000});
    console.log(`Recovery verified; executor privileges restored. Private receipt: ${receiptDir}`);
  } catch (error) {
    record('failed',{code:error.code || null});
    throw new Error(`Recovery stopped. Preserve private receipt: ${receiptDir}`, {cause: synthetic ? error : undefined});
  } finally {
    await db.$disconnect(); rmSync(work,{recursive:true,force:true});
    process.off('SIGINT',interrupt); process.off('SIGTERM',interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values}=parseArgs({options:{package:{type:'string'},sha256:{type:'string'},archive:{type:'string'},execute:{type:'boolean'}}});
  for (const name of ['package','sha256','archive']) assert.ok(values[name],`Missing --${name}`);
  await recover(values);
}
