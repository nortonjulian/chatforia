/** @jest-environment node */
import { beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';
import { makeAgent, resetDb } from './helpers/testServer.js';

const app = makeAgent().app;
const asUser = (method, path, id) => request(app)[method](path)
  .set('x-test-user-id', String(id));
const visual = { kind: 'IMAGE', mimeType: 'image/jpeg', url: 'media/synthetic.jpg' };

async function user(username, ageBand) {
  return prisma.user.create({ data: {
    username, passwordHash: 'synthetic-only', ageBand,
  } });
}

async function room(users, { random = false } = {}) {
  const chatRoom = await prisma.chatRoom.create({ data: { isGroup: users.length > 2 } });
  await prisma.participant.createMany({ data: users.map((u) => ({
    userId: u.id, chatRoomId: chatRoom.id,
  })) });
  if (random) await prisma.randomChatRoom.create({ data: { chatRoomId: chatRoom.id } });
  return chatRoom;
}

beforeEach(async () => resetDb());

describe('teen visual-media HTTP enforcement', () => {
  test('direct, group, and Random Chat reject image sends before persistence; text and adult media survive', async () => {
    const adult = await user('adult', 'ADULT_18_24');
    const adult2 = await user('adult2', 'ADULT_18_24');
    const teen = await user('teen', 'TEEN_13_17');
    for (const chatRoom of [
      await room([adult, teen]),
      await room([adult, adult2, teen]),
      await room([teen, await user('teen2', 'TEEN_13_17')], { random: true }),
    ]) {
      const senderId = chatRoom.isGroup ? adult.id :
        (await prisma.participant.findFirst({ where: { chatRoomId: chatRoom.id }, orderBy: { userId: 'desc' } })).userId;
      const denied = await asUser('post', '/messages', senderId)
        .send({ chatRoomId: chatRoom.id, content: 'caption', attachmentsInline: [visual] });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('TEEN_VISUAL_MEDIA_RESTRICTED');
      expect(await prisma.message.count({ where: { chatRoomId: chatRoom.id } })).toBe(0);
      const text = await asUser('post', '/messages', senderId)
        .send({ chatRoomId: chatRoom.id, content: 'ordinary text' });
      expect(text.status).toBe(201);
    }
    const adults = await room([adult, adult2]);
    const allowed = await asUser('post', '/messages', adult.id)
      .send({ chatRoomId: adults.id, content: 'adult photo', attachmentsInline: [visual] });
    expect(allowed.status).toBe(201);
    expect(allowed.body.message.attachments).toHaveLength(1);
  });

  test('historical visual media is absent from history, deltas, gallery, and private grant in a teen room', async () => {
    const adult = await user('adult', 'ADULT_18_24');
    const teen = await user('teen', 'TEEN_13_17');
    const chatRoom = await room([adult, teen]);
    const old = await prisma.message.create({ data: {
      chatRoom: { connect: { id: chatRoom.id } },
      sender: { connect: { id: adult.id } }, rawContent: 'keep text',
      attachments: { create: { kind: 'IMAGE', mimeType: 'image/jpeg', url: 'media/old.jpg' } },
    }, include: { attachments: true } });
    const history = await asUser('get', `/messages/${chatRoom.id}`, teen.id);
    expect(history.status).toBe(200);
    const message = history.body.items.find((item) => item.id === old.id);
    expect(message.rawContent).toBe('keep text');
    expect(message.attachments).toEqual([]);
    expect(message.mediaRestricted).toBe(true);
    const delta = await asUser('get', `/messages/${chatRoom.id}/deltas?sinceId=0`, teen.id);
    expect(delta.status).toBe(200);
    expect(delta.body.items[0].attachments).toEqual([]);
    const gallery = await asUser('get', `/media/chatrooms/${chatRoom.id}/media`, adult.id);
    expect(gallery.status).toBe(200);
    expect(gallery.body).toEqual([]);
    const grant = await asUser('get', `/private-media/message/${old.attachments[0].id}`, teen.id);
    expect(grant.status).toBe(404);
    const adultPeer = await user('adultpeer', 'ADULT_18_24');
    const adultRoom = await room([adult, adultPeer]);
    const forwarded = await asUser('post', `/messages/${old.id}/forward`, adult.id)
      .send({ toRoomId: adultRoom.id, note: 'forward' });
    expect(forwarded.status).toBe(403);
    expect(await prisma.message.count({ where: { chatRoomId: adultRoom.id } })).toBe(0);
  });
});
