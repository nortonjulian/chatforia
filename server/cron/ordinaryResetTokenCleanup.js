// Runtime cleanup must never attempt protected-account token DML. The database
// trigger remains authoritative if an account becomes protected concurrently.
export const ordinaryResetTokenOwner = {
  is: {
    role: { not: 'ADMIN' },
    staffAssignment: { is: null },
    founderOwnership: { is: null },
  },
};

export function deleteExpiredOrdinaryResetTokens(db, before) {
  return db.passwordResetToken.deleteMany({
    where: {
      expiresAt: { lt: before },
      user: ordinaryResetTokenOwner,
    },
  });
}

export function deleteOldUsedOrdinaryResetTokens(db, before) {
  return db.passwordResetToken.deleteMany({
    where: {
      usedAt: { not: null, lt: before },
      user: ordinaryResetTokenOwner,
    },
  });
}
