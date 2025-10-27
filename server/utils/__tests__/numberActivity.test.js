import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function loadModuleWithPrismaMock({ findFirstResult = null } = {}) {
  jest.resetModules();

  // freeze time for deterministic lastOutboundAt
  const fixedNow = new Date('2035-08-15T10:30:00.000Z');
  jest.useFakeTimers().setSystemTime(fixedNow);

  const findFirstMock = jest.fn(async () => {
    return findFirstResult;
  });

  const updateMock = jest.fn(async (args) => {
    return { ...findFirstResult, ...args.data };
  });

  const prismaMock = {
    phoneNumber: {
      findFirst: findFirstMock,
      update: updateMock,
    },
  };

  // 🔄 mock using the ALIAS so it's consistent everywhere
  jest.unstable_mockModule('@utils/prismaClient.js', () => ({
    default: prismaMock,
    prisma: prismaMock,
  }));

  const mod = await import('../../utils/numberActivity.js');

  return {
    mod,
    prismaMock,
    findFirstMock,
    updateMock,
    fixedNow,
  };
}

describe('bumpNumberActivity', () => {
  test('does nothing if user has no assigned or held number', async () => {
    const { mod, findFirstMock, updateMock } =
      await loadModuleWithPrismaMock({
        findFirstResult: null,
      });

    const { bumpNumberActivity } = mod;

    const result = await bumpNumberActivity(42);

    expect(result).toBeUndefined();

    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        assignedUserId: 42,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
    });

    expect(updateMock).not.toHaveBeenCalled();
  });

  test('updates number when found', async () => {
    const fakePhoneRow = {
      id: 999,
      assignedUserId: 7,
      status: 'HOLD',
      lastOutboundAt: null,
      holdUntil: new Date('2035-08-20T00:00:00.000Z'),
      releaseAfter: new Date('2035-08-30T00:00:00.000Z'),
    };

    const { mod, findFirstMock, updateMock, fixedNow } =
      await loadModuleWithPrismaMock({
        findFirstResult: fakePhoneRow,
      });

    const { bumpNumberActivity } = mod;

    await bumpNumberActivity(7);

    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        assignedUserId: 7,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
    });

    expect(updateMock).toHaveBeenCalledTimes(1);

    const updateArg = updateMock.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 999 });

    expect(updateArg.data.status).toBe('ASSIGNED');
    expect(updateArg.data.holdUntil).toBeNull();
    expect(updateArg.data.releaseAfter).toBeNull();
    expect(updateArg.data.lastOutboundAt).toEqual(fixedNow);
  });

  test('already ASSIGNED still bumps lastOutboundAt and clears timers', async () => {
    const alreadyAssigned = {
      id: 321,
      assignedUserId: 12,
      status: 'ASSIGNED',
      lastOutboundAt: new Date('2035-08-10T05:00:00.000Z'),
      holdUntil: new Date('2035-08-16T00:00:00.000Z'),
      releaseAfter: new Date('2035-08-17T00:00:00.000Z'),
    };

    const { mod, updateMock, fixedNow } =
      await loadModuleWithPrismaMock({
        findFirstResult: alreadyAssigned,
      });

    const { bumpNumberActivity } = mod;

    await bumpNumberActivity(12);

    const updateArg = updateMock.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 321 });
    expect(updateArg.data).toEqual({
      lastOutboundAt: fixedNow,
      status: 'ASSIGNED',
      holdUntil: null,
      releaseAfter: null,
    });
  });
});
