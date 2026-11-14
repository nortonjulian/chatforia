import { randomUUID } from 'node:crypto';

import { prisma } from '../utils/prismaClient.js';

function operationInProgress() {
  const err = new Error(
    'Another eSIM purchase or replacement is being processed for this account'
  );
  err.code = 'ESIM_OPERATION_IN_PROGRESS';
  return err;
}

export async function acquireEsimOperationLock({
  prismaClient = prisma,
  userId,
  operation,
  operationKey = null,
}) {
  const token = randomUUID();

  try {
    await prismaClient.esimOperationLock.create({
      data: {
        userId: Number(userId),
        token,
        operation: String(operation),
        operationKey:
          operationKey == null
            ? null
            : String(operationKey),
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      throw operationInProgress();
    }
    throw err;
  }

  let retained = false;

  return {
    retain() {
      retained = true;
    },
    allowRelease() {
      retained = false;
    },
    async release() {
      if (retained) return;

      await prismaClient.esimOperationLock.deleteMany({
        where: {
          userId: Number(userId),
          token,
        },
      });
    },
  };
}

export async function withEsimOperationLock(
  options,
  callback
) {
  const lock = await acquireEsimOperationLock(options);

  try {
    return await callback(lock);
  } finally {
    await lock.release();
  }
}
