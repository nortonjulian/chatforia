/**
 * Identify retryable PostgreSQL transaction conflicts.
 *
 * Retries must restart the entire transaction so that
 * authorization and assignments are loaded again.
 */
export function isRetryableTransactionConflict(error) {
  const seen = new Set();
  const pending = [error];

  while (pending.length > 0) {
    const current = pending.pop();

    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (
      current.code === 'P2034' ||
      current.code === '40001' ||
      current.meta?.code === '40001'
    ) {
      return true;
    }

    if (current.cause) pending.push(current.cause);
    if (current.originalError) pending.push(current.originalError);
  }

  return false;
}
