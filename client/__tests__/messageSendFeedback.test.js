import { isBlockedMessageSendError, messageSendFeedback } from '../src/utils/messageSendFeedback.js';

test('identifies the precise forbidden direct-interaction response', () => {
  const error = { response: { status: 403, data: { message: 'Direct interaction unavailable' } } };
  expect(isBlockedMessageSendError(error)).toBe(true);
  expect(messageSendFeedback(error).message).toMatch(/account block is active/i);
});

test('does not mistake unrelated 403 errors for an account block', () => {
  const error = { response: { status: 403, data: { error: 'Not a room participant' } } };
  expect(isBlockedMessageSendError(error)).toBe(false);
  expect(messageSendFeedback(error).message).toMatch(/please try again/i);
});

test('does not mistake offline and server failures for account blocks', () => {
  expect(isBlockedMessageSendError(new Error('Network Error'))).toBe(false);
  expect(isBlockedMessageSendError({ response: { status: 503, data: { error: 'Direct interaction unavailable' } } })).toBe(false);
});

test('does not identify a blocked user or which side initiated the block', () => {
  const notice = messageSendFeedback({response:{status:403,data:{error:'Direct interaction unavailable'}}});
  expect(notice.message).not.toMatch(/blocked you|blocked them|by the other user/i);
});
