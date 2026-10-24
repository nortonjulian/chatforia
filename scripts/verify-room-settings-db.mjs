// Rollback-only persistence checks for Room settings (no external services).
// Refuses anything except an explicitly selected localhost PostgreSQL test DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertTestDatabaseSelected } from '../server/__tests__/helpers/testDatabase.js';
import {
  RoleRank,
  canActOnRank,
  getEffectiveRoomRank,
} from '../server/utils/roomAuth.js';

const { raw, database } = assertTestDatabaseSelected();
const destination = new URL(raw);
if (!['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname)) {
  throw new Error('Room settings QA must use a LOCAL disposable PostgreSQL test database');
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: raw } } });
const rollback = new Error('Intentional QA rollback (no fixtures retained)');

try {
  await prisma.$transaction(async (db) => {
    const nonce = randomUUID().replaceAll('-', '');
    const newUser = async (label) => db.user.create({
      data: {
        username: `roomsettings_${label}_${nonce}`,
        passwordHash: 'test-fixture-not-a-login',
      },
    });
    const owner = await newUser('owner');
    const admin = await newUser('admin');
    const member = await newUser('member');
    const observer = await newUser('observer');

    const room = await db.chatRoom.create({
      data: {
        name: `Room settings QA ${nonce}`,
        isGroup: true,
        ownerId: owner.id,
        participants: {
          create: [
            { userId: owner.id, role: 'ADMIN' },
            { userId: admin.id, role: 'ADMIN' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    });

    assert.equal(
      await getEffectiveRoomRank(db, owner.id, room.id, 'MEMBER'),
      RoleRank.OWNER
    );
    assert.equal(
      await getEffectiveRoomRank(db, admin.id, room.id, 'MEMBER'),
      RoleRank.ADMIN
    );
    assert.equal(
      await getEffectiveRoomRank(db, member.id, room.id, 'MEMBER'),
      RoleRank.MEMBER
    );
    assert.equal(
      await getEffectiveRoomRank(db, observer.id, room.id, 'MEMBER'),
      null
    );
    assert.equal(canActOnRank(RoleRank.ADMIN, RoleRank.ADMIN), false);
    assert.equal(canActOnRank(RoleRank.ADMIN, RoleRank.MODERATOR), true);
    assert.equal(canActOnRank(RoleRank.MEMBER, RoleRank.MEMBER), false);

    const updatedRole = await db.participant.update({
      where: {
        chatRoomId_userId: { chatRoomId: room.id, userId: member.id },
      },
      data: { role: 'MODERATOR' },
      select: { role: true },
    });
    assert.equal(updatedRole.role, 'MODERATOR');
    assert.equal(
      await getEffectiveRoomRank(db, member.id, room.id, 'MEMBER'),
      RoleRank.MODERATOR
    );

    const updatedSettings = await db.chatRoom.update({
      where: { id: room.id },
      data: {
        aiAssistantMode: 'MENTION',
        allowForiaBot: true,
        autoTranslateMode: 'TAGGED',
      },
      select: {
        id: true,
        aiAssistantMode: true,
        allowForiaBot: true,
        autoTranslateMode: true,
      },
    });
    assert.equal(updatedSettings.aiAssistantMode, 'MENTION');
    assert.equal(updatedSettings.allowForiaBot, true);
    assert.equal(updatedSettings.autoTranslateMode, 'TAGGED');

    // A member's consent must not mutate any other member's preference.
    const optedOut = await db.participant.updateMany({
      where: { chatRoomId: room.id, userId: member.id },
      data: { allowAIBot: false },
    });
    assert.equal(optedOut.count, 1);
    const permissions = await db.participant.findMany({
      where: { chatRoomId: room.id },
      select: { userId: true, allowAIBot: true },
    });
    const byId = new Map(permissions.map((p) => [p.userId, p.allowAIBot]));
    assert.equal(byId.get(member.id), false);
    assert.equal(byId.get(admin.id), true);
    assert.equal(byId.get(owner.id), true);

    const disabled = await db.chatRoom.update({
      where: { id: room.id },
      data: {
        aiAssistantMode: 'OFF',
        allowForiaBot: false,
        autoTranslateMode: 'OFF',
      },
      select: {
        aiAssistantMode: true,
        allowForiaBot: true,
        autoTranslateMode: true,
      },
    });
    assert.equal(disabled.aiAssistantMode, 'OFF');
    assert.equal(disabled.allowForiaBot, false);
    assert.equal(disabled.autoTranslateMode, 'OFF');

    console.log('PASS: actual Prisma rank lookup, role update, enum persistence, room AI gate, and consent isolation');
    throw rollback;
  }, { timeout: 20000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await prisma.$disconnect();
}
console.log(`PASS: transaction rolled back in local test database ${database}; no QA fixtures retained`);
