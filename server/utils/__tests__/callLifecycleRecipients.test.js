import {
  collectCallLifecycleRecipientIds,
} from '../callLifecycleRecipients.js';

describe('collectCallLifecycleRecipientIds', () => {
  test('includes both primary participants, including the actor account', () => {
    expect(
      collectCallLifecycleRecipientIds({
        callerId: 1,
        calleeId: 24,
      })
    ).toEqual([1, 24]);
  });

  test('includes additional participants and removes duplicates', () => {
    expect(
      collectCallLifecycleRecipientIds({
        callerId: 1,
        calleeId: 24,
        participants: [
          { userId: 24 },
          { userId: 3 },
          { userId: '3' },
          { userId: null },
        ],
      })
    ).toEqual([1, 24, 3]);
  });
});
