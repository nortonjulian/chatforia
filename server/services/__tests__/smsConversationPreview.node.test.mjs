import assert from 'node:assert/strict';
import test from 'node:test';
import { smsConversationLast } from '../smsConversationPreview.js';

const at = new Date('2026-11-17T12:00:00.000Z');
const media = { hasMedia: false, mediaCount: 0, mediaKinds: [] };

test('outgoing SMS preview keeps direction and original text', () => {
  assert.deepEqual(smsConversationLast({ id: 42, createdAt: at, direction: 'out' }, 'Sent', media), {
    text: 'Sent', messageId: 42, at: at.toISOString(), direction: 'out',
    senderName: null, ...media,
  });
});

test('incoming SMS preview remains eligible for translation', () => {
  assert.equal(smsConversationLast({ id: 43, createdAt: at, direction: 'in' }, 'Received', media).direction, 'in');
});

test('empty thread has no preview', () => {
  assert.equal(smsConversationLast(null, '', media), null);
});
