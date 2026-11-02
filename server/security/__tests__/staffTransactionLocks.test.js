import { jest } from '@jest/globals';
import {
  lockStaffManagementUsers,
} from '../staffTransactionLocks.js';

function makeTransaction() {
  return {
    $queryRaw: jest.fn(async (strings, id) => [{ id }]),
  };
}

describe('staff management transaction locks', () => {
  test('locks accounts in ascending ID order', async () => {
    const tx = makeTransaction();

    const ids = await lockStaffManagementUsers(tx, 90, 12);

    expect(ids).toEqual([12, 90]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);

    expect(tx.$queryRaw.mock.calls[0][1]).toBe(12);
    expect(tx.$queryRaw.mock.calls[1][1]).toBe(90);
  });

  test('uses PostgreSQL row locks', async () => {
    const tx = makeTransaction();

    await lockStaffManagementUsers(tx, 10, 20);

    for (const [strings] of tx.$queryRaw.mock.calls) {
      const sql = strings.join(' ');
      expect(sql).toContain('FROM "User"');
      expect(sql).toContain('FOR UPDATE');
    }
  });

  test('rejects self-targeting operations', async () => {
    const tx = makeTransaction();

    await expect(
      lockStaffManagementUsers(tx, 10, 10)
    ).rejects.toThrow(/Invalid staff-management/);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test('rejects invalid account identifiers', async () => {
    const tx = makeTransaction();

    for (const id of [null, 0, -1, '10', 1.5]) {
      await expect(
        lockStaffManagementUsers(tx, id, 20)
      ).rejects.toThrow();

      await expect(
        lockStaffManagementUsers(tx, 10, id)
      ).rejects.toThrow();
    }

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test('requires a transactional query client', async () => {
    await expect(
      lockStaffManagementUsers({}, 10, 20)
    ).rejects.toThrow(/Transactional database client/);
  });

  test('rejects missing account rows', async () => {
    const tx = makeTransaction();

    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([]);

    await expect(
      lockStaffManagementUsers(tx, 10, 20)
    ).rejects.toThrow(/account unavailable/);
  });

  test('rejects mismatched account rows', async () => {
    const tx = makeTransaction();

    tx.$queryRaw.mockResolvedValue([{ id: 999 }]);

    await expect(
      lockStaffManagementUsers(tx, 10, 20)
    ).rejects.toThrow(/account unavailable/);
  });

  test('propagates database locking failures', async () => {
    const tx = makeTransaction();

    tx.$queryRaw.mockRejectedValue(
      new Error('Database lock failure')
    );

    await expect(
      lockStaffManagementUsers(tx, 10, 20)
    ).rejects.toThrow('Database lock failure');
  });
});
