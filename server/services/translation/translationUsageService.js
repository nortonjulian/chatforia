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

  const date = new Date();
  await assertAndConsumeUsage({
    userId,
    plan,
    meter: 'translationChars',
    amount: normalizedAmount,
    date,
  });

  let result;
  try {
    result = await operation();
  } catch (error) {
    try {
      await releaseUsage({
        userId,
        meter: 'translationChars',
        amount: normalizedAmount,
        date,
      });
    } catch (releaseError) {
      console.error(
        'Failed to release translation allowance',
        releaseError
      );
    }

    throw error;
  }

  // Keep refund failures outside the operation catch: retrying a refund whose
  // commit outcome is unknown could subtract another request's usage.
  if (!shouldBillResult(result)) {
    await releaseUsage({ userId, meter: 'translationChars', amount: normalizedAmount, date });
  }
  return result;
}
