import {
  isRetryableTransactionConflict,
} from '../transactionConflicts.js';

describe('PostgreSQL transaction conflict detection', () => {
  test('recognizes Prisma P2034', () => {
    expect(isRetryableTransactionConflict({
      code: 'P2034',
    })).toBe(true);
  });

  test('recognizes PostgreSQL 40001', () => {
    expect(isRetryableTransactionConflict({
      code: '40001',
    })).toBe(true);
  });

  test('recognizes PostgreSQL 40001 in Prisma metadata', () => {
    expect(isRetryableTransactionConflict({
      code: 'P2010',
      meta: { code: '40001' },
    })).toBe(true);
  });

  test('recognizes nested cause errors', () => {
    expect(isRetryableTransactionConflict({
      code: 'P2010',
      cause: {
        code: '40001',
      },
    })).toBe(true);
  });

  test('recognizes original driver errors', () => {
    expect(isRetryableTransactionConflict({
      originalError: {
        code: '40001',
      },
    })).toBe(true);
  });

  test('does not retry audit failures', () => {
    expect(isRetryableTransactionConflict({
      code: 'P2010',
      meta: { code: 'P0001' },
    })).toBe(false);
  });

  test('does not retry permission denials', () => {
    expect(isRetryableTransactionConflict({
      code: 'P2010',
      meta: { code: '42501' },
    })).toBe(false);
  });

  test('does not retry ordinary authorization failures', () => {
    expect(isRetryableTransactionConflict(
      new Error('Staff delegation authority denied.')
    )).toBe(false);
  });

  test('handles missing and primitive errors', () => {
    expect(isRetryableTransactionConflict(null)).toBe(false);
    expect(isRetryableTransactionConflict(undefined)).toBe(false);
    expect(isRetryableTransactionConflict('40001')).toBe(false);
  });

  test('handles circular error causes safely', () => {
    const error = { code: 'P2010' };
    error.cause = error;

    expect(isRetryableTransactionConflict(error)).toBe(false);
  });
});
