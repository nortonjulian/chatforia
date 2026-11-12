import { describe, expect, it, jest } from '@jest/globals';

import { dispatchVoicemailEmailOnce } from '../voicemailEmailDispatcher.js';

const id = 'twilio-REaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const user = { plan: 'PLUS', voicemailForwardEmail: 'owner@example.test', voicemailEmailForwardingEnabled: true };

function disposableStore() {
  const delivery = {
    voicemailId: id, userId: 65, recipient: 'owner@example.test',
    status: 'PENDING', attempts: 0, nextAttemptAt: new Date(0),
    leaseId: null, leaseUntil: null, sentAt: null,
    voicemail: {
      id, userId: 65, fromNumber: '+15551234567', toNumber: '+15557654321',
      audioUrl: 'https://api.twilio.com/recording.mp3', durationSec: 12,
      createdAt: new Date(0), forwardedToEmailAt: null,
    },
  };
  const eligible = (where) => {
    if (where.voicemailId && where.voicemailId !== delivery.voicemailId) return false;
    if (where.leaseId && where.leaseId !== delivery.leaseId) return false;
    if (typeof where.status === 'string' && where.status !== delivery.status) return false;
    if (where.attempts?.lt != null && delivery.attempts >= where.attempts.lt) return false;
    if (where.attempts?.gte != null && delivery.attempts < where.attempts.gte) return false;
    if (where.leaseUntil?.lte && (!delivery.leaseUntil || delivery.leaseUntil > where.leaseUntil.lte)) return false;
    if (where.OR) return where.OR.some((part) => {
      if (part.status !== delivery.status) return false;
      if (part.nextAttemptAt) return delivery.nextAttemptAt <= part.nextAttemptAt.lte;
      if (part.leaseUntil) return delivery.leaseUntil && delivery.leaseUntil <= part.leaseUntil.lte;
      return false;
    });
    return true;
  };
  const db = {
    voicemailEmailDelivery: {
      findMany: jest.fn(async ({ where }) => eligible(where) ? [{ voicemailId: id }] : []),
      findUnique: jest.fn(async () => ({ ...delivery, voicemail: { ...delivery.voicemail } })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!eligible(where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          delivery[key] = value?.increment != null ? delivery[key] + value.increment : value;
        }
        return { count: 1 };
      }),
    },
    user: { findUnique: jest.fn(async () => user) },
    voicemail: { updateMany: jest.fn(async ({ data }) => {
      delivery.voicemail.forwardedToEmailAt = data.forwardedToEmailAt;
      return { count: 1 };
    }) },
    $transaction: async (fn) => fn(db),
  };
  return { db, delivery };
}

describe('durable voicemail email dispatcher', () => {
  it('claims once across concurrent workers and records provider acceptance', async () => {
    const { db, delivery } = disposableStore();
    let confirm;
    const send = jest.fn(() => new Promise((resolve) => { confirm = resolve; }));
    const first = dispatchVoicemailEmailOnce({ db, now: () => new Date(10_000), send });
    const second = dispatchVoicemailEmailOnce({ db, now: () => new Date(10_000), send });
    await new Promise((resolve) => setImmediate(resolve));
    expect(send).toHaveBeenCalledTimes(1);
    confirm(true);
    await Promise.all([first, second]);
    expect(delivery.status).toBe('SENT');
    expect(delivery.voicemail.forwardedToEmailAt).toBeInstanceOf(Date);
  });

  it('recovers an expired claim after a worker restart', async () => {
    const { db, delivery } = disposableStore();
    delivery.status = 'PROCESSING';
    delivery.attempts = 1;
    delivery.leaseId = 'stopped-worker';
    delivery.leaseUntil = new Date(1000);
    const send = jest.fn(async () => true);
    await dispatchVoicemailEmailOnce({ db, now: () => new Date(2000), send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(delivery.status).toBe('SENT');
    expect(delivery.attempts).toBe(2);
  });

  it('marks an expired final attempt for review without sending again', async () => {
    const { db, delivery } = disposableStore();
    delivery.status = 'PROCESSING';
    delivery.attempts = 5;
    delivery.leaseId = 'stopped-on-last-attempt';
    delivery.leaseUntil = new Date(1000);
    const send = jest.fn();
    await dispatchVoicemailEmailOnce({ db, now: () => new Date(2000), send });
    expect(send).not.toHaveBeenCalled();
    expect(delivery.status).toBe('FAILED');
    expect(delivery.lastError).toBe('final_attempt_result_unknown');
  });

  it('backs off and stops after five unsuccessful provider attempts', async () => {
    const { db, delivery } = disposableStore();
    const send = jest.fn(async () => false);
    let clock = new Date(10_000);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await dispatchVoicemailEmailOnce({ db, now: () => clock, send });
      expect(delivery.attempts).toBe(attempt);
      clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
    }
    expect(delivery.status).toBe('FAILED');
    await dispatchVoicemailEmailOnce({ db, now: () => clock, send });
    expect(send).toHaveBeenCalledTimes(5);
    expect(delivery.voicemail.forwardedToEmailAt).toBeNull();
  });

  it('skips a stale recipient after the account turns forwarding off', async () => {
    const { db, delivery } = disposableStore();
    db.user.findUnique.mockResolvedValue({ ...user, voicemailEmailForwardingEnabled: false });
    const send = jest.fn();
    await dispatchVoicemailEmailOnce({ db, now: () => new Date(10_000), send });
    expect(send).not.toHaveBeenCalled();
    expect(delivery.status).toBe('SKIPPED');
  });

  it('leaves an expired lease for replay if success recording fails after provider acceptance', async () => {
    const { db, delivery } = disposableStore();
    const send = jest.fn(async () => true);
    db.$transaction = async () => { throw new Error('storage failure after acceptance'); };
    await expect(dispatchVoicemailEmailOnce({ db, now: () => new Date(10_000), send }))
      .rejects.toThrow('storage failure after acceptance');
    expect(delivery.status).toBe('PROCESSING');
    expect(delivery.leaseUntil).toBeInstanceOf(Date);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
