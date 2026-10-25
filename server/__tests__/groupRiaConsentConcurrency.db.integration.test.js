import { jest, test, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';

jest.setTimeout(45000);

const { raw, database } = assertTestDatabaseSelected();
const target = new URL(raw);

if (
  database !== 'chatforia_group_ria_staging_test' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
) {
  throw new Error('STOP: Only the local Group Ria staging test DB is allowed');
}

// No external bot webhook delivery in this isolated concurrency test.
await jest.unstable_mockModule('../services/botPlatform.js', () => ({
  enqueueBotEventsForMessage: jest.fn(async () => {}),
}));

const { createMessageService } =
  await import('../services/messageService.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function waitForBlockedParticipantLock(db) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rows = await db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query LIKE '%Participant%'
        AND query LIKE '%FOR SHARE%'
    `;

    if (rows[0]?.count > 0) return true;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return false;
}

test('committed consent revocation wins before plaintext persistence', async () => {
  const db = new PrismaClient({
    datasources: { db: { url: raw } },
  });

  const suffix = randomUUID().replaceAll('-', '');
  const users = [];
  let room = null;
  let releaseRevocation = null;
  let revocation = null;
  let submission = null;

  try {
    for (const label of ['sender', 'member', 'bot']) {
      users.push(await db.user.create({
        data: {
          username: `ria_lock_${label}_${suffix}`,
          passwordHash: 'disposable-test-only',
          strictE2EE: false,
        },
      }));
    }

    const [sender, member, bot] = users;

    room = await db.chatRoom.create({
      data: {
        name: `Ria Concurrency QA ${suffix}`,
        isGroup: true,
        ownerId: sender.id,
        allowForiaBot: true,
        aiAssistantMode: 'MENTION',
        participants: {
          create: [
            {
              userId: sender.id,
              allowAIBot: true,
              riaGroupConsentedAt: new Date(),
            },
            {
              userId: member.id,
              allowAIBot: true,
              riaGroupConsentedAt: new Date(),
            },
            {
              userId: bot.id,
              allowAIBot: false,
              riaGroupConsentedAt: null,
            },
          ],
        },
      },
    });

    process.env.GROUP_RIA_ENABLED = 'true';
    process.env.FORIA_BOT_USER_ID = String(bot.id);
    process.env.OPENAI_API_KEY = 'local-test-only';
    process.env.TRANSLATION_ENABLED = 'false';

    const revocationStarted = deferred();
    releaseRevocation = deferred();

    revocation = db.$transaction(async (tx) => {
      await tx.participant.update({
        where: {
          chatRoomId_userId: {
            chatRoomId: room.id,
            userId: sender.id,
          },
        },
        data: {
          allowAIBot: false,
          riaGroupConsentedAt: null,
        },
      });

      revocationStarted.resolve();
      await releaseRevocation.promise;
    }, { timeout: 20000 });

    // Propagate any transaction setup failure instead of hanging.
    void revocation.catch((error) => {
      revocationStarted.reject(error);
    });

    await revocationStarted.promise;

    const body = {
      chatRoomId: room.id,
      clientMessageId: `ria-v1:${suffix}`,
      content: '@Ria concurrency check',
      riaInvocation: {
        version: 1,
        acknowledgePlaintext: true,
      },
    };

    // Attach rejection handling immediately.
    submission = createMessageService({
      senderId: sender.id,
      chatRoomId: room.id,
      clientMessageId: body.clientMessageId,
      content: body.content,
      riaInvocationBody: body,
    }).then(
      (value) => ({ accepted: true, value }),
      (error) => ({ accepted: false, error })
    );

    // Require evidence that the message transaction is blocked
    // on the participant lock BEFORE releasing the revocation.
    const blocked = await waitForBlockedParticipantLock(db);

    expect(blocked).toBe(true);

    releaseRevocation.resolve();
    await revocation;

    const outcome = await submission;

    expect(outcome.accepted).toBe(false);
    expect(outcome.error?.name).toBe('GroupRiaInvocationError');
    expect(outcome.error?.code)
      .toBe('GROUP_RIA_SENDER_NOT_CONSENTED');

    const persisted = await db.message.count({
      where: {
        chatRoomId: room.id,
        senderId: sender.id,
        clientMessageId: body.clientMessageId,
      },
    });

    expect(persisted).toBe(0);

    console.log(
      'PASS: Concurrent revocation committed; no plaintext message persisted'
    );
  } finally {
    releaseRevocation?.resolve();

    if (revocation) await revocation.catch(() => {});
    if (submission) await submission.catch(() => {});

    if (room) {
      await db.chatRoom.delete({
        where: { id: room.id },
      });
    }

    if (users.length) {
      await db.user.deleteMany({
        where: {
          id: { in: users.map((user) => user.id) },
        },
      });
    }

    await db.$disconnect();
  }
});


async function waitForSqlLock(db, fragment) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const rows = await db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE ${'%' + fragment + '%'}
    `;
    if (rows[0]?.count > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test('invocation locks precede a concurrent consent revocation', async () => {
  const db = new PrismaClient({
    datasources: { db: { url: raw } },
  });

  const suffix = randomUUID().replaceAll('-', '');
  const users = [];
  let room = null;
  let blocker = null;
  let submission = null;
  let revocation = null;
  const releaseBlocker = deferred();
  const blockerReady = deferred();

  try {
    for (const label of ['sender', 'member', 'bot']) {
      users.push(await db.user.create({
        data: {
          username: `ria_reverse_${label}_${suffix}`,
          passwordHash: 'disposable-test-only',
          strictE2EE: false,
        },
      }));
    }

    const [sender, member, bot] = users;

    room = await db.chatRoom.create({
      data: {
        name: `Ria Reverse Lock QA ${suffix}`,
        isGroup: true,
        ownerId: sender.id,
        allowForiaBot: true,
        aiAssistantMode: 'MENTION',
        participants: {
          create: [
            {
              userId: sender.id,
              allowAIBot: true,
              riaGroupConsentedAt: new Date(),
            },
            {
              userId: member.id,
              allowAIBot: true,
              riaGroupConsentedAt: new Date(),
            },
            {
              userId: bot.id,
              allowAIBot: false,
              riaGroupConsentedAt: null,
            },
          ],
        },
      },
    });

    process.env.GROUP_RIA_ENABLED = 'true';
    process.env.FORIA_BOT_USER_ID = String(bot.id);
    process.env.OPENAI_API_KEY = 'local-test-only';
    process.env.TRANSLATION_ENABLED = 'false';

    // Block the message INSERT, not the earlier authorization reads.
    blocker = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'LOCK TABLE "Message" IN SHARE MODE'
      );
      blockerReady.resolve();
      await releaseBlocker.promise;
    }, { timeout: 20000 });

    void blocker.catch((error) => blockerReady.reject(error));
    await blockerReady.promise;

    const body = {
      chatRoomId: room.id,
      clientMessageId: `ria-v1:${suffix}`,
      content: '@Ria opposite ordering check',
      riaInvocation: {
        version: 1,
        acknowledgePlaintext: true,
      },
    };

    submission = createMessageService({
      senderId: sender.id,
      chatRoomId: room.id,
      clientMessageId: body.clientMessageId,
      content: body.content,
      riaInvocationBody: body,
    }).then(
      (value) => ({ accepted: true, value }),
      (error) => ({ accepted: false, error })
    );

    // This proves submission reached the INSERT, after obtaining
    // its transaction-level room/participant/user locks.
    expect(await waitForSqlLock(db, 'Message')).toBe(true);

    revocation = db.participant.update({
      where: {
        chatRoomId_userId: {
          chatRoomId: room.id,
          userId: sender.id,
        },
      },
      data: {
        allowAIBot: false,
        riaGroupConsentedAt: null,
      },
    }).then(
      (value) => ({ accepted: true, value }),
      (error) => ({ accepted: false, error })
    );

    // Revocation must now wait on the invocation's participant lock.
    expect(await waitForSqlLock(db, 'Participant')).toBe(true);

    releaseBlocker.resolve();
    await blocker;

    const sent = await submission;
    expect(sent.accepted).toBe(true);

    const revoked = await revocation;
    expect(revoked.accepted).toBe(true);

    const saved = await db.message.findFirst({
      where: {
        chatRoomId: room.id,
        senderId: sender.id,
        clientMessageId: body.clientMessageId,
      },
    });

    expect(saved).not.toBeNull();
    expect(saved.rawContent).toBe(body.content);

    const memberAfter = await db.participant.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: room.id,
          userId: sender.id,
        },
      },
    });

    expect(memberAfter.allowAIBot).toBe(false);
    expect(memberAfter.riaGroupConsentedAt).toBeNull();

    console.log(
      'PASS: Invocation committed before queued consent revocation'
    );
  } finally {
    releaseBlocker.resolve();

    if (blocker) await blocker.catch(() => {});
    if (submission) await submission.catch(() => {});
    if (revocation) await revocation.catch(() => {});

    if (room) {
      await db.chatRoom.delete({ where: { id: room.id } });
    }

    if (users.length) {
      await db.user.deleteMany({
        where: { id: { in: users.map((user) => user.id) } },
      });
    }

    await db.$disconnect();
  }
});
