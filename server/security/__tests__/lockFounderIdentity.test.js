import { jest } from '@jest/globals';
import {
  lockFounderIdentity,
} from '../lockFounderIdentity.js';

function makeTransaction(founderId = 66) {
  return {
    $queryRaw: jest.fn(async () => [{ id: 1 }]),
    founderOwnership: {
      findUnique: jest.fn(async () => ({
        id: 1,
        userId: founderId,
        user: {
          id: founderId,
          isBanned: false,
          deletedAt: null,
        },
      })),
    },
  };
}

describe('transactional founder identity protection', () => {
  test('locks and verifies founder ownership', async () => {
    const tx = makeTransaction();

    await expect(
      lockFounderIdentity(tx, 10, 20)
    ).resolves.toBe(66);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    const [strings, ...values] = tx.$queryRaw.mock.calls[0];
    const sql = strings.join(' ');

    expect(sql).toContain('pg_advisory_xact_lock');
    expect(values).toEqual([73421, 1]);

    expect(
      tx.$queryRaw.mock.invocationCallOrder[0]
    ).toBeLessThan(
      tx.founderOwnership.findUnique.mock.invocationCallOrder[0]
    );

    expect(
      tx.founderOwnership.findUnique
    ).toHaveBeenCalledTimes(1);
  });

  test('rejects founder as assigning administrator', async () => {
    const tx = makeTransaction();

    await expect(
      lockFounderIdentity(tx, 66, 20)
    ).rejects.toThrow(/Founder account cannot participate/);
  });

  test('rejects founder as target account', async () => {
    const tx = makeTransaction();

    await expect(
      lockFounderIdentity(tx, 10, 66)
    ).rejects.toThrow(/Founder account cannot participate/);
  });

  test('rejects missing founder ownership', async () => {
    const tx = makeTransaction();

    tx.founderOwnership.findUnique.mockResolvedValue(null);

    await expect(
      lockFounderIdentity(tx, 10, 20)
    ).rejects.toThrow(/not initialized or valid/);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid founder identity', async () => {
    const tx = makeTransaction();

    tx.founderOwnership.findUnique.mockResolvedValue({
      id: 1,
      userId: 66,
      user: {
        id: 99,
        isBanned: false,
        deletedAt: null,
      },
    });

    await expect(
      lockFounderIdentity(tx, 10, 20)
    ).rejects.toThrow(/not initialized or valid/);
  });

  test('rejects invalid actor or target IDs', async () => {
    const tx = makeTransaction();

    for (const id of [null, 0, -1, '10', 1.5]) {
      await expect(
        lockFounderIdentity(tx, id, 20)
      ).rejects.toThrow(/Invalid staff-management/);

      await expect(
        lockFounderIdentity(tx, 10, id)
      ).rejects.toThrow(/Invalid staff-management/);
    }

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test('requires a transactional client', async () => {
    await expect(
      lockFounderIdentity({}, 10, 20)
    ).rejects.toThrow(/Transactional founder verification/);
  });

  test('propagates database locking failures', async () => {
    const tx = makeTransaction();

    tx.$queryRaw.mockRejectedValue(
      new Error('Database lock failure')
    );

    await expect(
      lockFounderIdentity(tx, 10, 20)
    ).rejects.toThrow('Database lock failure');
  });
});
