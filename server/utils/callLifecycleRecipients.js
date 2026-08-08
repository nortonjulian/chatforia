export function collectCallLifecycleRecipientIds({
  callerId,
  calleeId,
  participants = [],
} = {}) {
  const recipientIds = new Set();

  const add = (value) => {
    const userId = Number(value);

    if (
      Number.isFinite(userId) &&
      userId > 0
    ) {
      recipientIds.add(userId);
    }
  };

  add(callerId);
  add(calleeId);

  for (const participant of participants) {
    add(participant?.userId);
  }

  return Array.from(recipientIds);
}
