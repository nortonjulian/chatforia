import { jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const planUsagePath = path.resolve(
  __dirname,
  '../planUsageService.js',
);

const assertAndConsumeUsageMock = jest.fn();
const releaseUsageMock = jest.fn();

await jest.unstable_mockModule(planUsagePath, () => ({
  assertAndConsumeUsage: assertAndConsumeUsageMock,
  releaseUsage: releaseUsageMock,
}));

const {
  countTranslationCharacters,
  withTranslationAllowance,
} = await import('../translation/translationUsageService.js');

describe('translationUsageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('counts Unicode code points rather than UTF-16 code units', () => {
    expect(countTranslationCharacters('A😀B')).toBe(3);
  });

  test('reserves translation characters and keeps successful billable usage', async () => {
    const operation = jest.fn().mockResolvedValue({
      translated: 'hola',
      provider: 'google',
    });

    const result = await withTranslationAllowance({
      userId: 42,
      plan: 'PLUS',
      amount: 5,
      operation,
      shouldBillResult: (value) => value.provider === 'google',
    });

    expect(result.translated).toBe('hola');
    expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
      userId: 42,
      plan: 'PLUS',
      meter: 'translationChars',
      amount: 5,
    });
    expect(releaseUsageMock).not.toHaveBeenCalled();
  });

  test('releases reservation for cache/no-op results', async () => {
    await withTranslationAllowance({
      userId: 42,
      plan: 'PLUS',
      amount: 5,
      operation: async () => ({ provider: 'cache' }),
      shouldBillResult: (value) => value.provider !== 'cache',
    });

    expect(releaseUsageMock).toHaveBeenCalledWith({
      userId: 42,
      meter: 'translationChars',
      amount: 5,
    });
  });

  test('releases reservation when provider operation throws', async () => {
    await expect(
      withTranslationAllowance({
        userId: 42,
        plan: 'PLUS',
        amount: 5,
        operation: async () => {
          throw new Error('provider failed');
        },
      })
    ).rejects.toThrow('provider failed');

    expect(releaseUsageMock).toHaveBeenCalledWith({
      userId: 42,
      meter: 'translationChars',
      amount: 5,
    });
  });

  test('zero-character operations do not touch the allowance counter', async () => {
    const result = await withTranslationAllowance({
      userId: 42,
      plan: 'PLUS',
      amount: 0,
      operation: async () => 'ok',
    });

    expect(result).toBe('ok');
    expect(assertAndConsumeUsageMock).not.toHaveBeenCalled();
    expect(releaseUsageMock).not.toHaveBeenCalled();
  });
});
