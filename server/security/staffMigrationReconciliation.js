import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifestPath = 'server/security/staffMigrationReconciliation.v1.json';
const manifestSha256 = '7f61bfb28b107d2bc6f61adfac0f0c2b2b4deec31089f69ae5ef3e52a212976a';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class ReconciliationError extends Error {}

export function loadReconciliationManifest(options = {}) {
  const bytes = readFileSync(options.manifestPath || manifestPath);
  if (sha256(bytes) !== manifestSha256)
    throw new ReconciliationError('Reconciliation manifest bytes changed');
  const manifest = JSON.parse(bytes);
  if (
    manifest.id !== 'chatforia-defaultdb-four-hash-20261103-v1' ||
    manifest.baselineCount !== 141 ||
    manifest.afterStaffCount !== 159 ||
    Object.keys(manifest.exceptions).length !== 4
  )
    throw new ReconciliationError('Reconciliation manifest shape changed');
  for (const [path, expected] of Object.entries(manifest.evidenceSha256)) {
    if (sha256(readFileSync(path)) !== expected)
      throw new ReconciliationError('Reconciliation evidence bytes changed');
  }
  return manifest;
}

export function assertReconciliationRequested(env, database, options = {}) {
  const manifest = loadReconciliationManifest(options);
  if (env.STAFF_MIGRATION_RECONCILIATION_ID !== manifest.id)
    throw new ReconciliationError('Unknown reconciliation ID');
  // This commit implements and exercises the mechanism only. The CLI supplies
  // no test option; changing the reviewed manifest/status is a separate release.
  if (manifest.status !== 'approved-for-production') {
    if (
      options.allowProposedForIsolatedTest !== true ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_EVENT_NAME !== 'pull_request' ||
      process.env.GITHUB_REPOSITORY !== 'nortonjulian/chatforia'
    )
      throw new ReconciliationError('Reconciliation is not approved for production');
  }
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new ReconciliationError('Reconciliation target is invalid');
  }
  if (
    database !== manifest.target.database ||
    url.pathname !== `/${manifest.target.database}` ||
    url.hostname.toLowerCase() !== manifest.target.hostname ||
    Number(url.port) !== manifest.target.port
  )
    throw new ReconciliationError('Reconciliation target differs from pinned target');
  return manifest;
}

export async function assertReconciliationCatalogAndData(db) {
  const [columns, indexes, constraints] = await Promise.all([
    db.$queryRaw`SELECT json_build_object('kind','column','table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) AS object FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname IN ('MobileDataPackPurchase','Report','SmsBlockedNumber','Device','EsimReplacement') AND a.attnum>0 AND NOT a.attisdropped`,
    db.$queryRaw`SELECT json_build_object('kind','index','table',t.relname,'name',i.relname,'definition',pg_get_indexdef(i.oid),'unique',x.indisunique,'valid',x.indisvalid) AS object FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('MobileDataPackPurchase','Report','SmsBlockedNumber','Device','EsimReplacement')`,
    db.$queryRaw`SELECT json_build_object('kind','constraint','table',t.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) AS object FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('MobileDataPackPurchase','Report','SmsBlockedNumber','Device','EsimReplacement')`,
  ]);
  const key = (entry) => `${entry.kind}/${entry.table}/${entry.name}`;
  const actual = [...columns, ...indexes, ...constraints].map(({ object }) => object).sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  const expected = JSON.parse(readFileSync('docs/staff-security/evidence/migration-target-catalog.json')).objects;
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new ReconciliationError('Reconciliation catalog differs from reviewed evidence');

  const [refund] = await db.$queryRaw`SELECT
    NOT EXISTS (SELECT 1 FROM public."MobileDataPackPurchase" WHERE "refundedAmountMinor" < 0 OR "refundedDataMb" < 0) AS "refundAmountsNonnegative",
    NOT EXISTS (SELECT 1 FROM public."MobileDataPackPurchase" WHERE "refundedAmountMinor" IS NULL OR "refundedDataMb" IS NULL OR "refundReviewRequired" IS NULL) AS "requiredDefaultsNonNull"`;
  const [reports] = await db.$queryRaw`SELECT
    NOT EXISTS (SELECT 1 FROM public."Report" WHERE "reportType" NOT IN ('APP','PSTN')) AS "reportTypesExpectedAppOrPstn",
    NOT EXISTS (SELECT 1 FROM public."Report" WHERE "reportType" IS NULL) AS "reportTypesNonNull",
    NOT EXISTS (SELECT 1 FROM public."Report" r WHERE r."smsMessageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."SmsMessage" s WHERE s.id=r."smsMessageId")) AS "smsLinksValid",
    NOT EXISTS (SELECT 1 FROM public."SmsBlockedNumber" b WHERE NOT EXISTS (SELECT 1 FROM public."User" u WHERE u.id=b."userId")) AS "blockedNumberUserLinksValid"`;
  const [tokens] = await db.$queryRaw`SELECT
    NOT EXISTS (SELECT 1 FROM public."Device" WHERE "apnsSandboxPushToken" IS NOT NULL GROUP BY "apnsSandboxPushToken" HAVING count(*)>1) AS "apnsSandboxTokensUniqueWhenPresent",
    NOT EXISTS (SELECT 1 FROM public."Device" WHERE "voipSandboxPushToken" IS NOT NULL GROUP BY "voipSandboxPushToken" HAVING count(*)>1) AS "voipSandboxTokensUniqueWhenPresent"`;
  const [replacements] = await db.$queryRaw`SELECT
    NOT EXISTS (SELECT 1 FROM public."EsimReplacement" WHERE status NOT IN ('PENDING','PROVISIONED','OLD_PACKAGE_TERMINATED','COMPLETED','REQUIRES_RECONCILIATION')) AS "statusesInApplicationSet",
    NOT EXISTS (SELECT 1 FROM public."EsimReplacement" WHERE "remainingDataMb" < 0 OR "replacementDataMb" < 0) AS "balancesNonnegative",
    NOT EXISTS (SELECT 1 FROM public."EsimReplacement" e JOIN public."MobileDataPackPurchase" p ON p.id=e."purchaseId" WHERE p."userId" IS DISTINCT FROM e."userId") AS "purchaseOwnerMatches",
    NOT EXISTS (SELECT 1 FROM public."EsimReplacement" e JOIN public."Subscriber" s ON s.id=e."oldSubscriberId" WHERE s."userId" IS DISTINCT FROM e."userId") AS "oldSubscriberOwnerMatches",
    NOT EXISTS (SELECT 1 FROM public."EsimReplacement" e JOIN public."Subscriber" s ON s.id=e."newSubscriberId" WHERE s."userId" IS DISTINCT FROM e."userId") AS "newSubscriberOwnerMatches"`;
  const evidence = JSON.parse(readFileSync('docs/staff-security/evidence/migration-current-data-invariants.json')).results;
  for (const [migration, result] of Object.entries({
    '20260726034500_add_wireless_refund_audit': refund,
    '20260806030000_add_pstn_reporting_and_blocking': reports,
    '20260807010000_add_sandbox_apns_tokens': tokens,
    '20261013_add_esim_replacement_audit': replacements,
  })) {
    if (Object.entries(evidence[migration]).some(([name, value]) => value !== true || result[name] !== true))
      throw new ReconciliationError('Reconciliation data predicates failed');
  }
}
