export function messageCacheKey(accountId, roomId) {
  const valid = (value) => {
    if (!/^[1-9][0-9]*$/.test(String(value ?? ''))) {
      return false;
    }
    return Number.isSafeInteger(Number(value));
  };

  if (!valid(accountId) || !valid(roomId)) {
    throw new Error('Message cache requires a valid account and room ID');
  }

  return `${accountId}:${roomId}`;
}

export function assertMessageCacheKey(value) {
  const key = String(value ?? '');
  const match = /^([1-9][0-9]*):([1-9][0-9]*)$/.exec(key);

  if (
    !match ||
    !Number.isSafeInteger(Number(match[1])) ||
    !Number.isSafeInteger(Number(match[2]))
  ) {
    throw new Error('Message cache requires an account-scoped key');
  }

  return key;
}
