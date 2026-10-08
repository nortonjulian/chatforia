import {
  assertAndConsumeUsage,
  releaseUsage,
} from '../planUsageService.js';

export function countTranslationCharacters(value) {
  return Array.from(String(value ?? '')).length;
}

export async function withTranslationAllowance({
  userId,
  plan,
  amount,
  operation,
  shouldBillResult = () => true,
}) {
  const normalizedAmount = Number(amount);

  if (!Number.isInteger(normalizedAmount) || normalizedAmount < 0) {
    throw new TypeError('translation amount must be a non-negative integer');
  }

  if (normalizedAmount === 0) {
    return operation();
  }

  await assertAndConsumeUsage({
    userId,
    plan,
    meter: 'translationChars',
    amount: normalizedAmount,
  });

  try {
    const result = await operation();

    if (!shouldBillResult(result)) {
      await releaseUsage({
        userId,
        meter: 'translationChars',
        amount: normalizedAmount,
      });
    }

    return result;
  } catch (error) {
    try {
      await releaseUsage({
        userId,
        meter: 'translationChars',
        amount: normalizedAmount,
      });
    } catch (releaseError) {
      console.error(
        'Failed to release translation allowance',
        releaseError
      );
    }

    throw error;
  }
}
