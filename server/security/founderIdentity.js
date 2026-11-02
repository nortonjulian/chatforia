import prisma from '../utils/prismaClient.js';

/**
 * Resolve the protected founder identity from the database.
 *
 * Missing or invalid ownership records fail closed.
 * Staff Access must never infer founder identity from a
 * username, email, or client-supplied account attribute.
 */
export async function getProtectedFounderUserId(db = prisma) {
  const ownership = await db.founderOwnership.findUnique({
    where: { id: 1 },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          isBanned: true,
          deletedAt: true,
        },
      },
    },
  });

  if (
    !ownership ||
    ownership.id !== 1 ||
    !Number.isSafeInteger(ownership.userId) ||
    ownership.userId <= 0 ||
    ownership.user?.id !== ownership.userId ||
    ownership.user?.isBanned !== false ||
    ownership.user?.deletedAt !== null
  ) {
    throw new Error(
      'Protected founder identity is not initialized or valid.'
    );
  }

  return ownership.userId;
}
