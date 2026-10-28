/** @jest-environment node */
import { describe, test, expect, jest } from '@jest/globals';
import { getAuthorizedMessageMedia, localMessageMediaPath, cloudMessageMediaKey } from '../services/privateMessageMedia.js';

const makeDb = (overrides = {}) => ({
  messageAttachment: { findUnique: jest.fn(async () => ({
    id: 12, url: 'media/voice.m4a', thumbUrl: 'thumbs/voice.jpg', deletedAt: null,
    message: {
      id: 15, chatRoomId: 9, senderId: 1,
      createdAt: new Date('2026-01-01'), expiresAt: null, deletedForAll: false,
      deletedBySender: false, deletions: [],
    },
  })) },
  participant: { findUnique: jest.fn(async () => ({ id: 4, clearedAt: null })) },
  threadState: { findUnique: jest.fn(async () => null) },
  ...overrides,
});

describe('private message attachment authorization', () => {
  const input = { attachmentId: 12, viewerId: 2 };
  test('authorized recipient and original/thumbnail path work', async () => {
    const db = makeDb();
    expect((await getAuthorizedMessageMedia({ ...input, db }))?.relativePath).toBe('media/voice.m4a');
    expect((await getAuthorizedMessageMedia({ ...input, db, variant: 'thumb' }))?.relativePath).toBe('thumbs/voice.jpg');
  });
  test('never returns a path when recipient is not a member', async () => {
    const db = makeDb({ participant: { findUnique: jest.fn(async () => null) } });
    expect(await getAuthorizedMessageMedia({ ...input, db })).toBeNull();
  });
  test('rejects message expiry, delete for all, per-user delete, and file deletion', async () => {
    for (const mutation of [
      a => { a.message.expiresAt = new Date('2025-01-01'); },
      a => { a.message.deletedForAll = true; },
      a => { a.message.deletions = [{ id: 3 }]; },
      a => { a.deletedAt = new Date(); },
    ]) {
      const db = makeDb();
      const get = db.messageAttachment.findUnique;
      const att = await get();
      mutation(att);
      get.mockResolvedValue(att);
      expect(await getAuthorizedMessageMedia({ ...input, db, now: new Date('2026-10-26') })).toBeNull();
    }
  });
  test('per-user clearing and deleting the conversation revokes old media', async () => {
    for (const key of ['clearedAt', 'deletedAt']) {
      const db = makeDb();
      if (key === 'clearedAt') db.participant.findUnique.mockResolvedValue({ id: 4, clearedAt: new Date('2026-08-01') });
      else db.threadState.findUnique.mockResolvedValue({ deletedAt: new Date('2026-08-01') });
      expect(await getAuthorizedMessageMedia({ ...input, db })).toBeNull();
    }
  });
  test('accepts only canonical Chatforia CDN object keys, rejects alternate hosts and traversal', () => {
    expect(cloudMessageMediaKey('https://cdn.chatforia.com/uploads/u2/voice.webm'))
      .toBe('uploads/u2/voice.webm');
    for (const bad of [
      'https://other.example/uploads/u2/voice.webm',
      'http://cdn.chatforia.com/uploads/u2/voice.webm',
      'https://cdn.chatforia.com.evil.example/uploads/u2/voice.webm',
      'https://cdn.chatforia.com/uploads/u2/%2e%2e/voice.webm',
      'https://cdn.chatforia.com/uploads/u2/voice.webm?token=foo',
      'https://cdn.chatforia.com/other/voice.webm',
    ]) expect(cloudMessageMediaKey(bad)).toBeNull();
  });
  test('authorized recipient can resolve CDN R2 object, unrelated participant cannot', async () => {
    const db = makeDb();
    const attachment = await db.messageAttachment.findUnique();
    attachment.url = 'https://cdn.chatforia.com/uploads/u1/voice.webm';
    db.messageAttachment.findUnique.mockResolvedValue(attachment);
    const result = await getAuthorizedMessageMedia({ ...input, db });
    expect(result?.storageKey).toBe('uploads/u1/voice.webm');
    expect(result?.relativePath).toBeNull();
    const blocked = makeDb({ participant: { findUnique: jest.fn(async () => null) } });
    blocked.messageAttachment.findUnique.mockResolvedValue(attachment);
    expect(await getAuthorizedMessageMedia({ ...input, db: blocked })).toBeNull();
  });
  test('new upload object keys resolve only for authorized room participants', async () => {
    const db = makeDb();
    const attachment = await db.messageAttachment.findUnique();
    attachment.url = 'uploads/u7/2026/10/26/voice.webm';
    db.messageAttachment.findUnique.mockResolvedValue(attachment);
    const accepted = await getAuthorizedMessageMedia({ ...input, db });
    expect(accepted?.storageKey).toBe(attachment.url);
    const stranger = makeDb({ participant: { findUnique: jest.fn(async () => null) } });
    stranger.messageAttachment.findUnique.mockResolvedValue(attachment);
    expect(await getAuthorizedMessageMedia({ ...input, db: stranger })).toBeNull();
  });

  test('rejects malformed upload object keys without changing CDN compatibility', () => {
    expect(cloudMessageMediaKey('uploads/u7/voice.webm')).toBe('uploads/u7/voice.webm');
    expect(cloudMessageMediaKey('uploads/u7/2026/10/26/voice.webm')).toBe('uploads/u7/2026/10/26/voice.webm');
    expect(cloudMessageMediaKey('https://cdn.chatforia.com/uploads/u7/voice.webm')).toBe('uploads/u7/voice.webm');
    for (const value of [
      'uploads/u7/../secret.webm',
      'uploads/u7/%2e%2e/voice.webm',
      'uploads/u7//voice.webm',
      'uploads/u7/voice.webm?token=secret',
      'uploads/u7/voice.webm#fragment',
      'uploads/u0/voice.webm',
      'uploads/u7/voice\\\\evil.webm',
      'https://cdn.chatforia.com/uploads/u7/../secret.webm',
    ]) expect(cloudMessageMediaKey(value)).toBeNull();
  });

  test('does not treat external URLs or traversal as local attachments', () => {
    for (const s of ['https://evil.test/a', '/etc/passwd', '../media/a.png', 'media/../a.png', 'media/%2e%2e', 'avatars/profile.png']) {
      expect(localMessageMediaPath(s)).toBeNull();
    }
  });
});
