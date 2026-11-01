/**
 * Coordinates the one-time administrator promotion.
 *
 * This module is not an HTTP endpoint or automatic startup hook.
 */
import { bootstrapInitialAdmin } from './initialAdminBootstrap.js';
import { validateBootstrapEnvironment } from './initialAdminBootstrapGuard.js';
import {
  validateInitialAdminExecutionAuthorization,
} from './initialAdminExecutionAuthorization.js';

import {
  requestInitialAdminExecutionConfirmation,
} from './initialAdminExecutionPrompt.js';

const EXPECTED_DATABASE = 'defaultdb';

const EXPECTED_ENDPOINT_FINGERPRINT =
  '268c88704efff766fae41e45416ac701b302fe6f067b5753a3fafb90e2789bc9';

export async function executeInitialAdminPromotion({
  prisma,
  databaseUrl,
  nodeEnv,
  requestConfirmation = requestInitialAdminExecutionConfirmation,
}) {
  if (nodeEnv !== 'production') {
    throw new Error('Production environment required');
  }

  if (!prisma?.$queryRaw || !prisma?.$transaction) {
    throw new Error('Transactional Prisma client required');
  }

  const rows = await prisma.$queryRaw`
    SELECT current_database() AS database_name,
           current_schema() AS schema_name
  `;

  const row = rows[0];

  // Reject an unexpected database before prompting the operator.
  // This preflight does not authorize execution.
  validateBootstrapEnvironment({
    nodeEnv,
    databaseUrl,
    expectedDatabase: EXPECTED_DATABASE,
    actualDatabase: row?.database_name,
    actualSchema: row?.schema_name,
    confirmation:
      `PROMOTE julian@chatforia.com ON ${EXPECTED_DATABASE}`,
    expectedEndpointFingerprint: EXPECTED_ENDPOINT_FINGERPRINT,
  });

  const confirmation = await requestConfirmation();

  validateInitialAdminExecutionAuthorization({
    execute: true,
    accountEmail: 'julian@chatforia.com',
    confirmation,
  });

  const before = await prisma.user.findUnique({
    where: { email: 'julian@chatforia.com' },
    select: {
      id: true,
      role: true,
      tokenVersion: true,
    },
  });

  if (
    !before ||
    before.role !== 'USER' ||
    !Number.isSafeInteger(before.tokenVersion)
  ) {
    throw new Error('Administrator pre-promotion state mismatch');
  }

  const result = await bootstrapInitialAdmin(prisma, {
    execute: true,
  });

  const after = await prisma.user.findUnique({
    where: { id: before.id },
    select: {
      role: true,
      tokenVersion: true,
    },
  });

  const audit = await prisma.auditLog.findFirst({
    where: {
      actorId: before.id,
      action: 'INITIAL_ADMIN_BOOTSTRAP',
      resource: 'user',
      resourceId: String(before.id),
    },
    orderBy: { createdAt: 'desc' },
  });

  if (
    result.mode !== 'executed' ||
    result.accountId !== before.id ||
    result.role !== 'ADMIN' ||
    result.sessionsRevoked !== true ||
    after?.role !== 'ADMIN' ||
    after?.tokenVersion !== before.tokenVersion + 1 ||
    !audit ||
    audit.status !== 200 ||
    audit.metadata?.source !== 'infrastructure_bootstrap'
  ) {
    throw new Error('Administrator post-promotion verification failed');
  }

  return {
    ...result,
    verified: true,
  };
}
