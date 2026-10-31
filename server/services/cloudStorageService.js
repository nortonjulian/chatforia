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

/**
 * Complete an issued presigned upload exactly once per owner/key.
 * HEAD object metadata must be verified by the caller before entering
 * this transaction. No client-supplied size/type is trusted here.
 */
export async function finalizePendingUploadWithinCloudStorageAllowance({
  userId,
  key,
  actualSize,
  actualMimeType,
  sha256,
}) {
  const ownerId = Number(userId);
  const size = Number(actualSize);

  if (!Number.isSafeInteger(ownerId) || ownerId <= 0 ||
      typeof key !== 'string' || !key) {
    const error = new Error('Invalid upload completion');
    error.code = 'INVALID_UPLOAD_COMPLETION';
    throw error;
  }

  const reject = (code) => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };

  return prisma.$transaction(async (tx) => {
    // Same per-user lock used by ordinary cloud upload accounting.
    // Serializes concurrent completion requests for this user.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock($1)',
      ownerId,
    );

    const pending = await tx.pendingUpload.findUnique({
      where: { key },
    });

    if (!pending || pending.ownerId !== ownerId) {
      reject('UPLOAD_INTENT_NOT_FOUND');
    }

    // Idempotent retry: do not charge storage a second time.
    if (pending.completedUploadId != null) {
      const existing = await tx.upload.findUnique({
        where: { id: pending.completedUploadId },
      });
      if (!existing || existing.ownerId !== ownerId ||
          existing.key !== key) {
        reject('UPLOAD_COMPLETION_CONFLICT');
      }
      return { upload: existing, alreadyCompleted: true };
    }

    if (pending.expiresAt <= new Date()) {
      reject('UPLOAD_INTENT_EXPIRED');
    }

    // A completed retry needs no new HEAD request. For a first
    // completion, require trusted storage metadata before accounting.
    if (!Number.isSafeInteger(size) || size <= 0 ||
        typeof actualMimeType !== 'string' || !actualMimeType) {
      reject('INVALID_UPLOAD_COMPLETION');
    }

    if (pending.expectedSize !== size ||
        pending.mimeType !== actualMimeType) {
      reject('UPLOAD_METADATA_MISMATCH');
    }

    const summary = await planAndUsage(tx, ownerId);

    if (summary.used + size > summary.limit) {
      throw storageAllowanceError({
        limit: summary.limit,
        used: summary.used,
        requested: size,
      });
    }

    const upload = await tx.upload.create({
      data: {
        ownerId,
        key,
        originalName: pending.originalName,
        mimeType: pending.mimeType,
        size,
        sha256,
        driver: 's3',
      },
    });

    await tx.pendingUpload.update({
      where: { id: pending.id },
      data: {
        completedAt: new Date(),
        completedUploadId: upload.id,
      },
    });

    return { upload, alreadyCompleted: false };
  });
}
