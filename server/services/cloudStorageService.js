import prisma from '../utils/prismaClient.js';
import { getPlanEntitlements } from '../config/planEntitlements.js';

export function storageAllowanceError({ limit, used, requested }) {
  const err = new Error('Cloud storage allowance exceeded');
  err.status = 413;
  err.code = 'STORAGE_ALLOWANCE_EXCEEDED';
  err.limit = limit;
  err.used = used;
  err.requested = requested;
  err.remaining = Math.max(0, limit - used);
  return err;
}

function normalizeSize(value) {
  const size = Math.floor(Number(value));
  if (!Number.isFinite(size) || size <= 0) {
    const err = new Error('Upload size must be a positive integer');
    err.status = 400;
    err.code = 'INVALID_UPLOAD_SIZE';
    throw err;
  }
  return size;
}

async function planAndUsage(db, userId) {
  const user = await db.user.findUnique({
    where: { id: Number(userId) },
    select: { plan: true },
  });

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const aggregate = await db.upload.aggregate({
    where: { ownerId: Number(userId) },
    _sum: { size: true },
  });

  const used = Number(aggregate?._sum?.size || 0);
  const entitlements = getPlanEntitlements(user.plan);
  const limit = Number(entitlements.cloudStorageBytes);

  return {
    plan: user.plan,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export async function getCloudStorageUsage(userId) {
  return planAndUsage(prisma, userId);
}

export async function assertCloudStorageAvailable({
  userId,
  requestedBytes,
}) {
  const requested = normalizeSize(requestedBytes);
  const summary = await planAndUsage(prisma, userId);

  if (summary.used + requested > summary.limit) {
    throw storageAllowanceError({
      limit: summary.limit,
      used: summary.used,
      requested,
    });
  }

  return {
    ...summary,
    requested,
    after: summary.used + requested,
  };
}

export async function createUploadWithinCloudStorageAllowance({
  userId,
  uploadData,
}) {
  const requested = normalizeSize(uploadData?.size);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock($1)',
      Number(userId),
    );

    const summary = await planAndUsage(tx, userId);

    if (summary.used + requested > summary.limit) {
      throw storageAllowanceError({
        limit: summary.limit,
        used: summary.used,
        requested,
      });
    }

    const upload = await tx.upload.create({
      data: {
        ...uploadData,
        ownerId: Number(userId),
        size: requested,
      },
      select: {
        id: true,
        ownerId: true,
        key: true,
        sha256: true,
        originalName: true,
        mimeType: true,
        size: true,
        driver: true,
        createdAt: true,
      },
    });

    return {
      upload,
      usage: {
        ...summary,
        requested,
        after: summary.used + requested,
      },
    };
  });
}
