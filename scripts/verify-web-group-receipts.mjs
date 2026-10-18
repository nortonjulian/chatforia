import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const source = async (path) => readFile(new URL(path, root), 'utf8');
const moduleFrom = async (path) => import(`data:text/javascript;base64,${Buffer.from(await source(path)).toString('base64')}`);
const { groupReceiptReaders } = await moduleFrom('client/src/utils/groupReadReceipts.js');
const { mergeRecoveredReadReceipts } = await moduleFrom('client/src/utils/readReceiptRecovery.js');
const julian = { id: 1, username: 'julian' };
const regina = { id: 65, username: 'regina' };
const row = (readBy = [], extra = {}) => ({
  id: 42, chatRoomId: 83, sender: { id: 68 }, readBy,
  content: 'decrypted edit', contentCiphertext: 'cipher', encryptedKey: 'key',
  originalContent: 'original', editedAt: '2026-10-18', ...extra,
});

test('one shared reader is identified', () => {
  assert.deepEqual(groupReceiptReaders(row([julian])), [{ id: 1, name: 'julian' }]);
});
test('two shared readers are independently identified', () => {
  assert.deepEqual(groupReceiptReaders(row([julian, regina])).map((r) => r.id), [1, 65]);
});
test('duplicate aliases and sender never increase the count', () => {
  assert.equal(groupReceiptReaders(row([julian, { ...julian, id: '1' }, regina, { id: 68 }])).length, 2);
});
test('invalid IDs and malformed reader arrays are ignored', () => {
  assert.deepEqual(groupReceiptReaders(row([null, {}, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: 'bad' }])), []);
  assert.deepEqual(groupReceiptReaders(row({ id: 1 })), []);
});
test('readAt alone cannot disclose a private group reader', () => {
  assert.deepEqual(groupReceiptReaders(row([], { readAt: '2026-10-18' })), []);
});
test('reenabling preferences does not add a formerly private reader', () => {
  assert.deepEqual(groupReceiptReaders(row([julian], { showReadReceipts: true })).map((r) => r.id), [1]);
});
test('historical shared reader survives their current OFF preference', () => {
  assert.equal(groupReceiptReaders(row([{ ...julian, showReadReceipts: false }])).length, 1);
});
test('deleted messages reveal no readers', () => {
  assert.deepEqual(groupReceiptReaders(row([julian], { deletedForAll: true })), []);
  assert.deepEqual(groupReceiptReaders(row([julian], { deletedAt: '2026-10-18' })), []);
});
test('missing names have an identifying fallback and names remain literal', () => {
  assert.deepEqual(groupReceiptReaders(row([{ id: 1 }, { id: 65, username: '<b>{{count}} %s</b>' }])).map((r) => r.name),
    ['User 1', '<b>{{count}} %s</b>']);
});
test('history recovery displays both readers without changing message content', () => {
  const message = row([julian]);
  const original = structuredClone(message);
  const [merged] = mergeRecoveredReadReceipts([message], [row([julian, regina])], 83);
  assert.equal(groupReceiptReaders(merged).length, 2);
  assert.deepEqual({ ...merged, readBy: original.readBy }, original);
  assert.deepEqual(message, original);
  assert.deepEqual(groupReceiptReaders(JSON.parse(JSON.stringify(merged))), groupReceiptReaders(merged));
});
test('private history and another room cannot add a reader', () => {
  const messages = [row([julian])];
  assert.strictEqual(mergeRecoveredReadReceipts(messages, [row([])], 83), messages);
  assert.strictEqual(mergeRecoveredReadReceipts(messages, [row([regina], { chatRoomId: 99 })], 83), messages);
});
test('group display is scoped to latest outgoing; direct-chat Seen stays intact', async () => {
  const view = await source('client/src/components/ChatView.jsx');
  assert.match(view, /isGroupChat && msg\.mine && isLastOutgoing && \(\s*<GroupReadReceipt message=\{msg\} \/>/);
  assert.match(view, /chatroom\?\.participants\?\.length === 2 && msg\.mine && isLastOutgoing && \(\s*<Text[^>]*>\s*\{lastOutgoingSeen \? 'Seen' : ''\}/);
  const component = await source('client/src/components/chat/GroupReadReceipt.jsx');
  assert.match(component, /aria-expanded=\{expanded\}/);
  assert.match(component, /groupReceiptReaders\(message\)/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
});
