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

test('adult SMS keeps direction, text and visible media metadata', () => {
  const adultMedia = {
    hasMedia: true, mediaCount: 1, mediaKinds: ['image'], thumbUrl: 'media/adult.jpg',
  };
  assert.deepEqual(
    smsConversationLast({ id: 44, createdAt: at, direction: 'out' }, 'Sent photo', adultMedia, false),
    {
      text: 'Sent photo', messageId: 44, at: at.toISOString(), direction: 'out',
      senderName: null, ...adultMedia, mediaRestricted: false,
    },
  );
});

test('teen SMS keeps only filtered media and marks hidden items restricted', () => {
  const visibleMedia = { hasMedia: false, mediaCount: 0, mediaKinds: [], thumbUrl: null };
  const last = smsConversationLast(
    { id: 45, createdAt: at, direction: 'in' }, '', visibleMedia, true,
  );
  assert.deepEqual(last, {
    text: '', messageId: 45, at: at.toISOString(), direction: 'in',
    senderName: null, ...visibleMedia, mediaRestricted: true,
  });
});

test('empty thread has no preview', () => {
  assert.equal(smsConversationLast(null, '', media), null);
});
