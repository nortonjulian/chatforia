import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';

const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
};

const assertAndConsumeUsageMock = jest.fn();
const releaseUsageMock = jest.fn();

await jest.unstable_mockModule('@prisma/client', () => ({
  __esModule: true,
  default: {
    PrismaClient: class {
      constructor() {
        return prismaMock;
      }
    },
  },
}));

await jest.unstable_mockModule('../services/planUsageService.js', () => ({
  assertAndConsumeUsage: assertAndConsumeUsageMock,
  releaseUsage: releaseUsageMock,
}));

await jest.unstable_mockModule('openai', () => ({
  __esModule: true,
  default: class {},
}));

const { __testables } = await import('../routes/randomChats.js');

describe('Random Chat Ria allowance helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses socket user plan without extra database lookup', async () => {
    const plan = await __testables.resolveRiaPlan({
      id: 42,
      plan: 'PLUS',
    });

    expect(plan).toBe('PLUS');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  test('loads plan from database when socket user does not include it', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      plan: 'PREMIUM',
    });

    const plan = await __testables.resolveRiaPlan({
      id: 42,
    });

    expect(plan).toBe('PREMIUM');
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { plan: true },
    });
  });

  test('consumes one Ria action on successful Random Chat AI operation', async () => {
    const result = await __testables.withRandomChatRiaAllowance(
      {
        id: 42,
        plan: 'PLUS',
      },
      async () => 'ria-reply',
    );

    expect(result).toBe('ria-reply');

    expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
      userId: 42,
      plan: 'PLUS',
      meter: 'riaActions',
      amount: 1,
    });

    expect(releaseUsageMock).not.toHaveBeenCalled();
  });

  test('releases reserved Ria action when provider operation fails', async () => {
    const providerError = Object.assign(
      new Error('provider failed'),
      { code: 'OPENAI_DOWN' },
    );

    await expect(
      __testables.withRandomChatRiaAllowance(
        {
          id: 42,
          plan: 'FREE',
        },
        async () => {
          throw providerError;
        },
      ),
    ).rejects.toBe(providerError);

    expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
      userId: 42,
      plan: 'FREE',
      meter: 'riaActions',
      amount: 1,
    });

    expect(releaseUsageMock).toHaveBeenCalledWith({
      userId: 42,
      meter: 'riaActions',
      amount: 1,
    });
  });

  test('does not call provider operation when allowance is exhausted', async () => {
    const allowanceError = Object.assign(
      new Error('Plan allowance exceeded'),
      {
        code: 'PLAN_ALLOWANCE_EXCEEDED',
        limit: 20,
        used: 20,
        remaining: 0,
      },
    );

    assertAndConsumeUsageMock.mockRejectedValueOnce(
      allowanceError,
    );

    const operation = jest.fn();

    await expect(
      __testables.withRandomChatRiaAllowance(
        {
          id: 42,
          plan: 'FREE',
        },
        operation,
      ),
    ).rejects.toBe(allowanceError);

    expect(operation).not.toHaveBeenCalled();
    expect(releaseUsageMock).not.toHaveBeenCalled();
  });

  test('emits structured allowance error plus visible Ria notice', () => {
    const socket = {
      emit: jest.fn(),
    };

    __testables.emitRiaFailure(
      socket,
      'random:AI:42',
      {
        code: 'PLAN_ALLOWANCE_EXCEEDED',
        limit: 20,
        used: 20,
        remaining: 0,
      },
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'random:ria_error',
      {
        roomId: 'random:AI:42',
        code: 'PLAN_ALLOWANCE_EXCEEDED',
        meter: 'riaActions',
        limit: 20,
        used: 20,
        remaining: 0,
      },
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'random:message',
      expect.objectContaining({
        senderId: 0,
        randomChatRoomId: 'random:AI:42',
        errorCode: 'PLAN_ALLOWANCE_EXCEEDED',
        system: true,
      }),
    );
  });
});
