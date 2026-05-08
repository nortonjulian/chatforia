/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils.js';

/* ---------- Vite/env-safe mocks ---------- */
jest.mock('@/utils/toast', () => ({
  __esModule: true,
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

/* ---------- Premium / ads ---------- */
jest.mock('@/hooks/useIsPremium', () => ({
  __esModule: true,
  default: () => true,
}));

jest.mock('@/ads/AdProvider', () => ({
  __esModule: true,
  useAds: () => ({
    canShow: () => false,
    markShown: jest.fn(),
  }),
}));

jest.mock('@/ads/AdWrappers', () => ({
  __esModule: true,
  CardAdWrap: ({ children }) => <div>{children}</div>,
}));

jest.mock('@/ads/HouseAdSlot', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/ads/placements', () => ({
  __esModule: true,
  PLACEMENTS: {
    EMPTY_STATE_PROMO: 'empty_state_promo',
    THREAD_TOP: 'thread_top',
  },
}));

jest.mock('@/ads/config', () => ({
  __esModule: true,
  ADS_CONFIG: { house: {} },
}));

/* ---------- Context ---------- */
jest.mock('@/context/SocketContext', () => ({
  __esModule: true,
  useSocket: () => ({
    socket: {
      connected: true,
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    },
  }),
}));

jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    setNeedsKeyUnlock: jest.fn(),
  }),
}));

/* ---------- Icons ---------- */
jest.mock('@tabler/icons-react', () => {
  const React = require('react');
  return new Proxy(
    {},
    {
      get: () => (props) => React.createElement('svg', props),
    }
  );
});

/* ---------- Light child components ---------- */
jest.mock('@/threads/ThreadComposer.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="thread-composer" />,
}));

jest.mock('@/threads/ThreadShell.jsx', () => ({
  __esModule: true,
  default: ({ header, children, composer }) => (
    <div>
      <div data-testid="thread-header">{header}</div>
      <div data-testid="thread-body">{children}</div>
      <div data-testid="thread-composer-slot">{composer}</div>
    </div>
  ),
}));

jest.mock('@/threads/ThreadActionsMenu.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="thread-actions-menu" />,
}));

jest.mock('@/components/SmartReplyBar.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="smart-reply-bar" />,
}));

jest.mock('@/components/RoomSettingsModal.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/RoomInviteModal.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/RoomAboutModal.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/RoomSearchDrawer.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/MediaGalleryModal.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/chat/ReportModal.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/EmojiPicker.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/StickerPicker.jsx', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/chat/MessageBubble.jsx', () => ({
  __esModule: true,
  default: ({ msg }) => (
    <div data-testid="message-bubble">
      {msg?.decryptedContent || msg?.translatedForMe || msg?.rawContent || msg?.content}
    </div>
  ),
}));

/* ---------- Networking / helpers ---------- */
jest.mock('@/api/axiosClient', () => {
  const get = jest.fn();
  const post = jest.fn();
  const patch = jest.fn();
  const deleteFn = jest.fn();

  return {
    __esModule: true,
    default: {
      get,
      post,
      patch,
      delete: deleteFn,
    },
  };
});

jest.mock('@/lib/api', () => ({
  __esModule: true,
  fetchLatestMessages: jest.fn(),
  fetchOlderMessages: jest.fn(),
  fetchMessageDeltas: jest.fn(),
}));

jest.mock('@/utils/encryptionClient', () => ({
  __esModule: true,
  reportMessage: jest.fn(),
  encryptForRoom: jest.fn(),
  decryptFetchedMessages: jest.fn(async (items) =>
    items.map((i) => ({
      ...i,
      decryptedContent: i.decryptedContent ?? i.content,
    }))
  ),
}));

jest.mock('@/utils/loadEncryptionClient', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    getUnlockedPrivateKey: jest.fn(async () => null),
    getUnlockedPrivateKeyForPublicKey: jest.fn(async () => null),
    decryptFetchedMessages: jest.fn(async (items) => items),
  })),
}));

jest.mock('@/utils/messagesStore', () => ({
  __esModule: true,
  addMessages: jest.fn(() => Promise.resolve()),
  upsertMessage: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/utils/prefsStore', () => ({
  __esModule: true,
  getPref: jest.fn(async () => false),
  setPref: jest.fn(async () => {}),
  PREF_SMART_REPLIES: 'PREF_SMART_REPLIES',
}));

jest.mock('@/hooks/useSmartReplies.js', () => ({
  __esModule: true,
  useSmartReplies: () => ({
    suggestions: [],
    clear: jest.fn(),
  }),
}));

jest.mock('@/lib/sounds.js', () => ({
  __esModule: true,
  playSound: jest.fn(),
}));

/* ---------- Import under test ---------- */
import ChatView from '../src/components/ChatView.jsx';
import axiosClient from '@/api/axiosClient';
import { fetchLatestMessages } from '@/lib/api';

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    });
  }

  window.confirm = jest.fn(() => true);
  window.alert = jest.fn();
  window.prompt = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();

  fetchLatestMessages.mockResolvedValue({
    items: [],
    nextCursor: null,
  });

  axiosClient.post.mockResolvedValue({ data: {} });
});

test('shows “Select a conversation” when no chatroom', () => {
  renderWithRouter(
    <ChatView currentUserId={1} currentUser={{}} chatroom={null} />
  );

  expect(screen.getByText(/select a conversation/i)).toBeInTheDocument();
  expect(screen.getByText(/pick a chat on the left/i)).toBeInTheDocument();
});

test('loads initial messages and renders room title', async () => {
  fetchLatestMessages.mockResolvedValueOnce({
    items: [
      {
        id: 3,
        content: 'Third',
        sender: { id: 1 },
        createdAt: '2026-01-01T00:00:03.000Z',
      },
      {
        id: 2,
        content: 'Second',
        sender: { id: 2 },
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    ],
    nextCursor: null,
  });

  renderWithRouter(
    <ChatView
      chatroom={{
        id: 10,
        name: 'Room X',
        participants: [{ id: 1 }, { id: 2 }],
      }}
      currentUserId={1}
      currentUser={{ id: 1 }}
    />
  );

  expect(screen.getByText('Room X')).toBeInTheDocument();

  await waitFor(() =>
    expect(fetchLatestMessages).toHaveBeenCalledWith(10, 50)
  );

  expect(await screen.findByText(/second/i)).toBeInTheDocument();
  expect(await screen.findByText(/third/i)).toBeInTheDocument();
});