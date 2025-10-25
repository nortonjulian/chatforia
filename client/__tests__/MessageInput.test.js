/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils.js';

// ---- Mock toast (avoids evaluating import.meta.env in src/utils/toast) ----
jest.mock('../src/utils/toast', () => ({
  __esModule: true,
  toast: {
    ok: jest.fn(),
    err: jest.fn(),
    info: jest.fn(),
  },
}));

// ---- Mock encryption (keeps tests fast and avoids pulling extra deps) ----
jest.mock('@/utils/encryptionClient', () => ({
  __esModule: true,
  encryptForRoom: jest.fn(async (_participants, text) => ({
    iv: 'iv',
    ct: `enc:${text}`,
    alg: 'mock-aes',
    keyIds: [],
  })),
}));

// ---- axiosClient mock ----
const mockPost = jest.fn();
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...a) => mockPost(...a) },
}));

// ---- StickerPicker mock ----
// When opened, clicking it "picks" a sticker and closes.
jest.mock('../src/components/StickerPicker.jsx', () => ({
  __esModule: true,
  default: ({ opened, onPick, onClose }) =>
    opened ? (
      <button
        onClick={() => {
          onPick({ kind: 'STICKER', url: 'http://s' });
          onClose();
        }}
      >
        PickSticker
      </button>
    ) : null,
}));

// ---- SUT (import AFTER mocks) ----
import MessageInput from '../src/components/MessageInput.jsx';

beforeEach(() => {
  jest.clearAllMocks();
});

test('disables send when nothing to send', () => {
  renderWithRouter(
    <MessageInput chatroomId={123} currentUser={{}} onMessageSent={() => {}} />
  );
  // ActionIcon is the send button with aria-label="Send"
  expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
});

test('sends trimmed text and calls onMessageSent', async () => {
  const saved = { id: 9, content: 'hi' };
  mockPost.mockResolvedValueOnce({ data: saved });

  const onMessageSent = jest.fn();
  renderWithRouter(
    <MessageInput chatroomId={5} currentUser={{}} onMessageSent={onMessageSent} />
  );

  await userEvent.type(screen.getByPlaceholderText(/say something/i), '  hi  ');
  await userEvent.click(screen.getByRole('button', { name: /send/i }));

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(onMessageSent).toHaveBeenCalledWith(saved);
  });
});

test('adds a sticker inline and enables send', async () => {
  mockPost.mockResolvedValueOnce({ data: { id: 1 } });

  renderWithRouter(
    <MessageInput chatroomId={7} currentUser={{}} onMessageSent={() => {}} />
  );

  // Open sticker picker (Button with child "😀")
  await userEvent.click(screen.getByRole('button', { name: '😀' }));
  // Click the mock picker action to inject a sticker
  await userEvent.click(screen.getByRole('button', { name: /picksticker/i }));

  const send = screen.getByRole('button', { name: /send/i });
  expect(send).not.toBeDisabled();

  await userEvent.click(send);
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
});
