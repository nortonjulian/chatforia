import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function loadModuleWithPrismaMock({
  findFirstResult = null,
} = {}) {
  jest.resetModules();

  // Freeze time so we can assert the timestamp passed to update()
  const fixedNow = new Date('2035-08-15T10:30:00.000Z');
  jest.useFakeTimers().setSystemTime(fixedNow);

  const findFirstMock = jest.fn(async (args) => {
    // we can assert the query shape in tests using this mock's calls
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

  jest.unstable_mockModule('../../utils/prismaClient.js', () => ({
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
    const { mod, prismaMock, findFirstMock, updateMock } =
      await loadModuleWithPrismaMock({
        findFirstResult: null, // simulate no number found
      });

    const { bumpNumberActivity } = mod;

    const result = await bumpNumberActivity(42);

    // function returns undefined in this path
    expect(result).toBeUndefined();

    // check query criteria
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        assignedUserId: 42,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
    });

    // should not attempt to update anything
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('updates number when found: sets lastOutboundAt now, forces status ASSIGNED, clears hold/release', async () => {
    const fakePhoneRow = {
      id: 999,
      assignedUserId: 7,
      status: 'HOLD',
      lastOutboundAt: null,
      holdUntil: new Date('2035-08-20T00:00:00.000Z'),
      releaseAfter: new Date('2035-08-30T00:00:00.000Z'),
    };

    const {
      mod,
      findFirstMock,
      updateMock,
      fixedNow,
    } = await loadModuleWithPrismaMock({
      findFirstResult: fakePhoneRow,
    });

    const { bumpNumberActivity } = mod;

    await bumpNumberActivity(7);

    // Assert query criteria: must look for status in ['ASSIGNED','HOLD']
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        assignedUserId: 7,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
    });

    // Assert update call shape
    expect(updateMock).toHaveBeenCalledTimes(1);

    const updateArg = updateMock.mock.calls[0][0];

    // It should update the FOUND id
    expect(updateArg.where).toEqual({ id: 999 });

    // Data fields should match the contract:
    //   - lastOutboundAt: now
    //   - status: 'ASSIGNED'
    //   - holdUntil: null
    //   - releaseAfter: null
    expect(updateArg.data.status).toBe('ASSIGNED');
    expect(updateArg.data.holdUntil).toBeNull();
    expect(updateArg.data.releaseAfter).toBeNull();

    // Timestamp should match frozen system time
    expect(updateArg.data.lastOutboundAt).toEqual(fixedNow);
  });

  test('if number is already ASSIGNED, it still bumps lastOutboundAt and clears timers', async () => {
    const alreadyAssigned = {
      id: 321,
      assignedUserId: 12,
      status: 'ASSIGNED',
      lastOutboundAt: new Date('2035-08-10T05:00:00.000Z'),
      holdUntil: new Date('2035-08-16T00:00:00.000Z'),
      releaseAfter: new Date('2035-08-17T00:00:00.000Z'),
    };

    const {
      mod,
      updateMock,
      fixedNow,
    } = await loadModuleWithPrismaMock({
      findFirstResult: alreadyAssigned,
    });

    const { bumpNumberActivity } = mod;

    await bumpNumberActivity(12);

    const updateArg = updateMock.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 321 });

    // Even though it was already ASSIGNED, we still expect:
    expect(updateArg.data).toEqual({
      lastOutboundAt: fixedNow,
      status: 'ASSIGNED',        // stays ASSIGNED
      holdUntil: null,           // cleared
      releaseAfter: null,        // cleared
    });
  });
});
