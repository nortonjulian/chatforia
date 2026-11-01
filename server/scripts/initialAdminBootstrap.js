import {
  INITIAL_ADMIN_EMAIL,
  validateInitialAdminAccount,
} from './initialAdminBootstrapValidation.js';

/**
 * One-time company administrator bootstrap.
 *
 * This function accepts an injected Prisma client and performs no
 * operation until explicitly invoked by a separate runner.
 */
export async function bootstrapInitialAdmin(prisma, {
  execute = false,
} = {}) {
  if (!prisma?.user?.findMany) {
    throw new Error('Valid Prisma client required');
  }

  const candidates = await prisma.user.findMany({
    where: {
      email: {
        equals: INITIAL_ADMIN_EMAIL,
        mode: 'insensitive',
      },
    },
    take: 2,
  });

  if (candidates.length !== 1) {
    throw new Error('Expected exactly one company administrator account');
  }

  const account = validateInitialAdminAccount(candidates[0]);

  if (!execute) {
    return {
      mode: 'dry-run',
      accountId: account.id,
      email: account.email,
      currentRole: account.role,
      eligible: true,
    };
  }

  if (typeof prisma.$transaction !== 'function') {
    throw new Error('Transactional Prisma client required');
  }

  return promoteValidatedAdmin(prisma, account);
}

/**
 * Transactional promotion of an already validated company account.
 * This helper is not an HTTP endpoint or command-line entry point.
 */
async function promoteValidatedAdmin(prisma, account) {
  // The public entry point has already validated the full account.
  // This helper receives only its validated identity and session version.
  if (
    !Number.isSafeInteger(account?.id) ||
    account.id <= 0 ||
    account.id > 2147483647 ||
    account.email !== INITIAL_ADMIN_EMAIL ||
    account.role !== 'USER' ||
    !Number.isSafeInteger(account.tokenVersion) ||
    account.tokenVersion < 0
  ) {
    throw new Error('Invalid validated administrator account');
  }

  if (typeof prisma?.$transaction !== 'function') {
    throw new Error('Transactional Prisma client required');
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: account.id },
    });

    const verified = validateInitialAdminAccount(current);

    if (
      verified.id !== account.id ||
      verified.email !== account.email ||
      verified.tokenVersion !== account.tokenVersion
    ) {
      throw new Error('Administrator bootstrap account changed');
    }

    const updated = await tx.user.updateMany({
      where: {
        id: account.id,
        email: INITIAL_ADMIN_EMAIL,
        role: 'USER',
        twoFactorEnabled: true,
        emailVerifiedAt: current.emailVerifiedAt,
        twoFactorEnrolledAt: current.twoFactorEnrolledAt,
        totpSecretEnc: current.totpSecretEnc,
        tokenVersion: account.tokenVersion,
        isBanned: false,
        deletedAt: null,
      },
      data: {
        role: 'ADMIN',
        tokenVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new Error('Administrator bootstrap preconditions changed');
    }

    await tx.auditLog.create({
      data: {
        actorId: account.id,
        action: 'INITIAL_ADMIN_BOOTSTRAP',
        resource: 'user',
        resourceId: String(account.id),
        status: 200,
        metadata: {
          source: 'infrastructure_bootstrap',
          initiatedBy: 'infrastructure_operator',
          selfService: false,
          previousRole: 'USER',
          newRole: 'ADMIN',
          sessionsRevoked: true,
        },
      },
    });

    return {
      mode: 'executed',
      accountId: account.id,
      email: account.email,
      role: 'ADMIN',
      sessionsRevoked: true,
    };
  });
}
