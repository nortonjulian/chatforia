import { jest, test, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';

jest.setTimeout(30000);

const { raw, database } = assertTestDatabaseSelected();
const target = new URL(raw);

if (
  database !== 'chatforia_group_ria_staging_test' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
) {
  throw new Error('STOP: Local Group Ria test database required');
}

const { createMessageService } =
  await import('../services/messageService.js');

async function waitForConcurrentRoomLocks(db) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const rows = await db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%ChatRoom%'
        AND query ILIKE '%FOR UPDATE%'
    `;

    if (rows[0]?.count >= 2) return rows[0].count;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return 0;
}

test('completed Group Ria request reuses its persisted source message', async () => {
  const db = new PrismaClient({
    datasources: { db: { url: raw } },
  });

  const suffix = randomUUID().replaceAll('-', '');
  const users = [];
  let room = null;

  const envBefore = {
    flag: process.env.GROUP_RIA_ENABLED,
    bot: process.env.FORIA_BOT_USER_ID,
    key: process.env.OPENAI_API_KEY,
    translation: process.env.TRANSLATION_ENABLED,
  };

  try {
    for (const label of ['sender', 'member', 'bot']) {
      users.push(await db.user.create({
        data: {
          username: `ria_retry_${label}_${suffix}`,
          passwordHash: 'disposable-test-only',
          strictE2EE: false,
        },
      }));
    }

    const [sender, member, bot] = users;

    room = await db.chatRoom.create({
      data: {
        name: `Ria Retry QA ${suffix}`,
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

    const body = {
      chatRoomId: room.id,
      clientMessageId: `ria-v1:${suffix}`,
      content: '@Ria retry verification',
      riaInvocation: {
        version: 1,
        acknowledgePlaintext: true,
      },
    };

    const requestParams = {
      senderId: sender.id,
      chatRoomId: room.id,
      clientMessageId: body.clientMessageId,
      content: body.content,
      riaInvocationBody: body,
    };

    // Each call executes separately rather than sharing
    // the rollback-only transaction of the positive test.
    const first = await createMessageService(requestParams);
    const second = await createMessageService(requestParams);

    expect(first.id).toBe(second.id);

    const stored = await db.message.findMany({
      where: {
        chatRoomId: room.id,
        senderId: sender.id,
        clientMessageId: body.clientMessageId,
      },
      select: {
        id: true,
        rawContent: true,
      },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(first.id);
    expect(stored[0].rawContent).toBe(body.content);

    // SIMULTANEOUS RETRY REGRESSION
    // Hold the room lock until both service calls have passed
    // their initial idempotency lookup.
    const parallelId = `ria-v1:${suffix}parallel`;
    const parallelBody = {
      ...body,
      clientMessageId: parallelId,
    };
    const parallelParams = {
      ...requestParams,
      clientMessageId: parallelId,
      riaInvocationBody: parallelBody,
    };

    let releaseBlocker;
    let blockerReady;

    const released = new Promise((resolve) => {
      releaseBlocker = resolve;
    });

    const ready = new Promise((resolve, reject) => {
      blockerReady = { resolve, reject };
    });

    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "ChatRoom"
        WHERE "id" = ${room.id}
        FOR UPDATE
      `;
      blockerReady.resolve();
      await released;
    }, { timeout: 20000 });

    void blocker.catch((error) => blockerReady.reject(error));

    let attempts = [];
    let blockedCount = 0;

    try {
      await ready;

      attempts = [1, 2].map(() =>
        createMessageService(parallelParams).then(
          (value) => ({ ok: true, id: value.id }),
          (error) => ({
            ok: false,
            code: error?.code || error?.message || 'unknown',
          })
        )
      );

      // Both calls must reach the room lock while it is held.
      // This ensures we are testing a real overlapping retry.
      blockedCount = await waitForConcurrentRoomLocks(db);
    } finally {
      releaseBlocker();
      await blocker.catch(() => {});
    }

    const outcomes = await Promise.all(attempts);

    expect(blockedCount).toBeGreaterThanOrEqual(2);

    // Both callers should get a successful response referring
    // to the same source message.
    expect(outcomes.map((result) => result.ok))
      .toEqual([true, true]);

    expect(outcomes[0].id).toBe(outcomes[1].id);

    const parallelStored = await db.message.findMany({
      where: {
        chatRoomId: room.id,
        senderId: sender.id,
        clientMessageId: parallelId,
      },
      select: { id: true },
    });

    expect(parallelStored).toHaveLength(1);

    console.log(
      'PASS: Simultaneous retries returned one source message'
    );

    console.log(
      'PASS: Sequential retry reused one source message across transactions'
    );
  } finally {
    if (room) {
      await db.chatRoom.delete({ where: { id: room.id } });
    }

    if (users.length) {
      await db.user.deleteMany({
        where: {
          id: { in: users.map((user) => user.id) },
        },
      });
    }

    for (const [key, original] of Object.entries({
      GROUP_RIA_ENABLED: envBefore.flag,
      FORIA_BOT_USER_ID: envBefore.bot,
      OPENAI_API_KEY: envBefore.key,
      TRANSLATION_ENABLED: envBefore.translation,
    })) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }

    await db.$disconnect();
  }
});
