import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// QA-only reconciliation helper. Caller is the fresh-cluster harness, never an
// application route. No connection URL, input archive or operator CLI is exposed.
export const recoveryDatasets = Object.freeze({
  staffEvents: 'public."StaffAccessEvent"',
  audits: 'public."AuditLog"',
  recoveryEvents: 'staff_security.credential_recovery_event',
  assertions: 'staff_security.consumed_assertions',
  mfaAssertions: 'staff_security.mfa_login_assertions',
  approvals: 'staff_security.credential_recovery_approval',
});
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );
export const evidenceDigest = (value) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export const signEvidence = (evidence, key) =>
  createHmac('sha256', key)
    .update(`staff-restore-evidence-v1:${canonical(evidence)}`)
    .digest('hex');
export async function captureEvidence(tx) {
  const datasets = {};
  for (const [name, table] of Object.entries(recoveryDatasets)) {
    datasets[name] = (
      await tx.$queryRawUnsafe(
        `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`
      )
    ).map((r) => r.row);
  }
  return {
    datasets,
    assignments: (
      await tx.$queryRawUnsafe(
        'SELECT to_jsonb(t) AS row FROM public."StaffAssignment" t ORDER BY id'
      )
    ).map((r) => r.row),
    users: await tx.user.findMany({
      select: { id: true, tokenVersion: true },
      orderBy: { id: 'asc' },
    }),
  };
}
export function verifyEvidence(
  envelope,
  { key, sourceId, backupSha256, schemaSha256 }
) {
  const { evidence, signature } = envelope;
  assert.ok(
    typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature),
    'Invalid evidence signature encoding'
  );
  const expected = Buffer.from(signEvidence(evidence, key), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  assert.ok(
    supplied.length === expected.length && timingSafeEqual(supplied, expected),
    'Unauthenticated recovery evidence'
  );
  assert.equal(evidence.sourceId, sourceId, 'Wrong source identity');
  assert.equal(evidence.backupSha256, backupSha256, 'Wrong backup');
  assert.equal(evidence.schemaSha256, schemaSha256, 'Wrong schema');
  assert.equal(evidence.complete, true, 'Incomplete recovery evidence');
  assert.equal(evidence.sourceWritersStopped, true, 'Source is not fenced');
  assert.ok(
    Number.isFinite(Date.parse(evidence.watermark)),
    'Missing source watermark'
  );
  assert.deepEqual(
    Object.keys(evidence.datasets).sort(),
    Object.keys(recoveryDatasets).sort(),
    'Incomplete security datasets'
  );
  assert.deepEqual(
    evidence.users.map((u) => u.id),
    evidence.snapshotUserIds,
    'Incomplete user security state'
  );
  assert.ok(
    evidence.users.every(
      (u) =>
        Number.isSafeInteger(u.id) &&
        Number.isSafeInteger(u.tokenVersion) &&
        u.tokenVersion >= 0
    ),
    'Invalid session floor'
  );
  return evidence;
}
export async function prepareReconciliationLedger(admin) {
  // Private fixture-only objects, not a proposed migration or runtime privilege.
  await admin.$executeRawUnsafe(
    'CREATE SCHEMA staff_restore_qa AUTHORIZATION chatforia_staff_owner'
  );
  await admin.$executeRawUnsafe(
    'REVOKE ALL ON SCHEMA staff_restore_qa FROM PUBLIC, chatforia_dev'
  );
  await admin.$executeRawUnsafe(
    'CREATE TABLE staff_restore_qa.batch (digest text PRIMARY KEY, completed boolean NOT NULL)'
  );
  await admin.$executeRawUnsafe(
    'CREATE TABLE staff_restore_qa.entry (batch text NOT NULL, dataset text NOT NULL, source_key text NOT NULL, payload jsonb NOT NULL, target_key text NOT NULL, PRIMARY KEY(batch,dataset,source_key))'
  );
}
const sourceKey = (name, row) =>
  name === 'assertions'
    ? row.assertion_id
    : name === 'mfaAssertions'
      ? row.nonce
      : name === 'approvals'
        ? row.token_hash
        : String(row.id);
export async function reconcileEvidence(
  admin,
  envelope,
  trust,
  { failAudit = false } = {}
) {
  const evidence = verifyEvidence(envelope, trust),
    digest = evidenceDigest(evidence);
  return admin.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(73421,1)::text`;
      const done =
        await tx.$queryRaw`SELECT completed FROM staff_restore_qa.batch WHERE digest=${digest}`;
      if (done[0]?.completed) return { digest, changed: false };
      await tx.$executeRaw`INSERT INTO staff_restore_qa.batch VALUES (${digest},false)`;
      for (const [name, table] of Object.entries(recoveryDatasets))
        for (const row of evidence.datasets[name]) {
          const key = sourceKey(name, row),
            payload = JSON.stringify(row);
          let targetKey = key;
          if (name === 'audits') {
            const existing =
              await tx.$queryRaw`SELECT to_jsonb(t) AS row FROM public."AuditLog" t WHERE id=${row.id}`;
            if (
              !existing.length ||
              evidenceDigest(existing[0].row) !== evidenceDigest(row)
            ) {
              // Containment may have used the same sequence ID as a lost source
              // audit. Append a new record; preserve both originals and a signed
              // source->target mapping instead of overwriting immutable history.
              const metadata = JSON.stringify({
                originalMetadata: row.metadata,
                restoreEvidence: {
                  digest,
                  sourceId: evidence.sourceId,
                  sourceAuditId: row.id,
                  recordDigest: evidenceDigest(row),
                },
              });
              await tx.$executeRawUnsafe(
                'SET LOCAL ROLE chatforia_staff_owner'
              );
              await tx.$executeRaw`INSERT INTO public."AuditLog" ("actorId",action,resource,"resourceId",status,ip,"userAgent",metadata,"createdAt") VALUES (${row.actorId},${row.action},${row.resource},${row.resourceId},${row.status},${row.ip},${row.userAgent},${metadata}::jsonb,${row.createdAt}::timestamp)`;
              targetKey = String(
                (
                  await tx.$queryRawUnsafe(
                    'SELECT currval(\'public."AuditLog_id_seq"\')::integer AS id'
                  )
                )[0].id
              );
              await tx.$executeRawUnsafe('RESET ROLE');
            }
          } else if (name === 'approvals') {
            // Never revive an approval. Retain original signed payload in ledger;
            // restored approvals stay expired and source consumption is preserved.
            await tx.$executeRawUnsafe(
              `UPDATE ${table} SET consumed_at=coalesce(consumed_at,($1::jsonb->>'consumed_at')::timestamptz), expires_at=least(expires_at,created_at+interval '1 microsecond') WHERE token_hash=decode(substring($1::jsonb->>'token_hash' FROM 3),'hex')`,
              payload
            );
            const n = await tx.$queryRawUnsafe(
              `SELECT count(*)::integer AS n FROM ${table} WHERE token_hash=decode(substring($1::jsonb->>'token_hash' FROM 3),'hex')`,
              payload
            );
            // Missing post-backup approvals are imported expired, never actionable.
            if (n[0].n === 0)
              await tx.$executeRawUnsafe(
                `INSERT INTO ${table} SELECT r.token_hash,r.target_user_id,r.value_hash,r.action,r.created_at+interval '1 microsecond',r.approved_by,r.consumed_at,r.created_at FROM jsonb_populate_record(NULL::${table},$1::jsonb) r`,
                payload
              );
          } else {
            const column =
              name === 'assertions'
                ? 'assertion_id'
                : name === 'mfaAssertions'
                  ? 'nonce'
                  : 'id';
            const current = await tx.$queryRawUnsafe(
              `SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${column}::text=$1`,
              key
            );
            if (current.length) {
              if (name === 'assertions') {
                const { consumed_at: oldTime, ...oldClaims } = current[0].row;
                const { consumed_at: sourceTime, ...sourceClaims } = row;
                assert.equal(
                  evidenceDigest(oldClaims),
                  evidenceDigest(sourceClaims),
                  'Conflicting assertion identity'
                );
                assert.ok(
                  Date.parse(sourceTime) <= Date.parse(oldTime),
                  'Unexplained earlier restored consumption'
                );
                await tx.$executeRawUnsafe(
                  `UPDATE ${table} SET consumed_at=$1::timestamptz WHERE assertion_id=$2::uuid`,
                  sourceTime,
                  key
                );
              } else
                assert.equal(
                  evidenceDigest(current[0].row),
                  evidenceDigest(row),
                  'Conflicting immutable/replay history'
                );
            } else {
              await tx.$executeRawUnsafe(
                'SET LOCAL ROLE chatforia_staff_owner'
              );
              await tx.$executeRawUnsafe(
                `INSERT INTO ${table} ${name === 'recoveryEvents' ? 'OVERRIDING SYSTEM VALUE' : ''} SELECT (jsonb_populate_record(NULL::${table},$1::jsonb)).*`,
                payload
              );
              await tx.$executeRawUnsafe('RESET ROLE');
            }
          }
          await tx.$executeRaw`INSERT INTO staff_restore_qa.entry VALUES (${digest},${name},${key},${payload}::jsonb,${targetKey})`;
        }
      for (const incoming of evidence.assignments) {
        // Exact current authority comes from the authenticated, fenced source.
        // Fresh credentials remain a separate gate before any listener is opened.
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
        await tx.$executeRawUnsafe(
          'INSERT INTO public."StaffAssignment" SELECT (jsonb_populate_record(NULL::public."StaffAssignment",$1::jsonb)).* ON CONFLICT ("userId") DO UPDATE SET profile=excluded.profile,active=excluded.active,"grantedById"=excluded."grantedById","grantedAt"=excluded."grantedAt","revokedById"=excluded."revokedById","revokedAt"=excluded."revokedAt","updatedAt"=excluded."updatedAt"',
          JSON.stringify(incoming)
        );
        await tx.$executeRawUnsafe('RESET ROLE');
      }
      for (const user of evidence.users) {
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
        await tx.$executeRaw`UPDATE public."User" SET "tokenVersion"=greatest("tokenVersion",${user.tokenVersion}+1) WHERE id=${user.id}`;
        await tx.$executeRawUnsafe('RESET ROLE');
      }
      // Imported explicit IDs must never collide with later recovery/event writes.
      for (const [table, sequence] of [
        ['public."StaffAccessEvent"', 'public."StaffAccessEvent_id_seq"'],
        [
          'staff_security.credential_recovery_event',
          'staff_security.credential_recovery_event_id_seq',
        ],
      ]) {
        await tx.$queryRawUnsafe(
          `SELECT setval($1::regclass,greatest((SELECT coalesce(max(id),1) FROM ${table}),(SELECT last_value FROM ${sequence})),true)`,
          sequence
        );
      }
      const auditStatus = failAudit ? null : 200;
      const metadata = JSON.stringify({
        evidenceDigest: digest,
        sourceId: evidence.sourceId,
        watermark: evidence.watermark,
        reopenApproved: false,
      });
      await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
      await tx.$executeRaw`INSERT INTO public."AuditLog" ("actorId",action,resource,"resourceId",status,metadata) VALUES (1,'STAFF_RESTORE_RECONCILED','staff_restore',${digest},${auditStatus}::integer,${metadata}::jsonb)`;
      await tx.$executeRawUnsafe('RESET ROLE');
      await tx.$executeRaw`UPDATE staff_restore_qa.batch SET completed=true WHERE digest=${digest}`;
      return { digest, changed: true };
    },
    { isolationLevel: 'Serializable', timeout: 15000 }
  );
}
export async function assertReconciled(admin, envelope, trust) {
  const e = verifyEvidence(envelope, trust),
    digest = evidenceDigest(e);
  const batches =
    await admin.$queryRaw`SELECT completed FROM staff_restore_qa.batch WHERE digest=${digest}`;
  assert.equal(batches[0]?.completed, true, 'Reconciliation not committed');
  const rows =
    await admin.$queryRaw`SELECT dataset,source_key,payload,target_key FROM staff_restore_qa.entry WHERE batch=${digest}`;
  assert.equal(
    rows.length,
    Object.values(e.datasets).reduce((n, r) => n + r.length, 0),
    'Incomplete reconciliation ledger'
  );
  for (const [name, list] of Object.entries(e.datasets))
    for (const payload of list) {
      const mapped = rows.find(
        (r) => r.dataset === name && r.source_key === sourceKey(name, payload)
      );
      assert.ok(
        mapped && evidenceDigest(mapped.payload) === evidenceDigest(payload),
        'Missing signed source record'
      );
      if (name === 'audits') {
        const [target] =
          await admin.$queryRaw`SELECT to_jsonb(t) AS row FROM public."AuditLog" t WHERE id=${Number(mapped.target_key)}`;
        assert.ok(target, 'Missing reconciled audit');
        assert.ok(
          evidenceDigest(target.row) === evidenceDigest(payload) ||
            (target.row.metadata?.restoreEvidence?.recordDigest ===
              evidenceDigest(payload) &&
              target.row.metadata.restoreEvidence.digest === digest &&
              target.row.metadata.restoreEvidence.sourceId === e.sourceId &&
              target.row.metadata.restoreEvidence.sourceAuditId ===
                payload.id &&
              evidenceDigest(
                Object.fromEntries(
                  Object.entries(target.row).filter(
                    ([key]) => !['id', 'metadata'].includes(key)
                  )
                )
              ) ===
                evidenceDigest(
                  Object.fromEntries(
                    Object.entries(payload).filter(
                      ([key]) => !['id', 'metadata'].includes(key)
                    )
                  )
                ) &&
              evidenceDigest(target.row.metadata.originalMetadata) ===
                evidenceDigest(payload.metadata)),
          'Reconciled audit payload mismatch'
        );
      } else if (name === 'approvals') {
        const [target] = await admin.$queryRawUnsafe(
          "SELECT to_jsonb(t) AS row FROM staff_security.credential_recovery_approval t WHERE token_hash=decode(substring($1 FROM 3),'hex')",
          mapped.target_key
        );
        assert.ok(target, 'Missing reconciled approval');
        const identity = (row) =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => !['expires_at', 'consumed_at'].includes(key)
            )
          );
        assert.equal(
          evidenceDigest(identity(target.row)),
          evidenceDigest(identity(payload)),
          'Approval identity mismatch'
        );
        assert.ok(
          Date.parse(target.row.expires_at) <= Date.now(),
          'Restored approval revived'
        );
        if (payload.consumed_at)
          assert.ok(target.row.consumed_at, 'Consumed approval resurrected');
      } else {
        const column =
          name === 'assertions'
            ? 'assertion_id'
            : name === 'mfaAssertions'
              ? 'nonce'
              : 'id';
        const [target] = await admin.$queryRawUnsafe(
          `SELECT to_jsonb(t) AS row FROM ${recoveryDatasets[name]} t WHERE ${column}::text=$1`,
          mapped.target_key
        );
        assert.ok(
          target && evidenceDigest(target.row) === evidenceDigest(payload),
          'Reconciled history/replay payload mismatch'
        );
      }
    }
  for (const incoming of e.assignments) {
    const current = await admin.staffAssignment.findUnique({
      where: { userId: incoming.userId },
    });
    assert.equal(current?.active, incoming.active, 'Restored grant mismatch');
    assert.equal(
      current?.profile,
      incoming.profile,
      'Restored profile mismatch'
    );
  }
  const activeIds = (
    await admin.staffAssignment.findMany({
      where: { active: true },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    })
  ).map((row) => row.userId);
  assert.deepEqual(
    activeIds,
    e.assignments
      .filter((row) => row.active)
      .map((row) => row.userId)
      .sort((a, b) => a - b),
    'Unapproved active grant'
  );
  for (const incoming of e.users)
    assert.ok(
      (await admin.user.findUnique({ where: { id: incoming.id } }))
        .tokenVersion > incoming.tokenVersion,
      'Revocation version floor lost'
    );
  assert.equal(
    (
      await admin.$queryRawUnsafe(
        'SELECT count(*)::integer AS n FROM staff_security.credential_recovery_approval WHERE consumed_at IS NULL AND expires_at>clock_timestamp()'
      )
    )[0].n,
    0,
    'Restored approval still actionable'
  );
  return digest;
}
