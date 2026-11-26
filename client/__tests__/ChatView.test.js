/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils.js';
import { createNativeThreadSessionCache } from '../src/utils/nativeThreadSessionCache.js';

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


jest.mock('@mantine/notifications', () => ({
  __esModule: true,
  notifications: {
    show: jest.fn(),
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
  useSocket: (() => {
    const socket = {
      connected: true,
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };
    return () => ({ socket });
  })(),
}));

jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    setNeedsKeyUnlock: jest.fn(),
  }),
}));

jest.mock('@/context/CallContext', () => ({
  __esModule: true,
  useCall: () => ({
    startCall: jest.fn(),
    active: null,
    incoming: null,
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
  default: ({ onBlock }) => (
    <div data-testid="thread-actions-menu">
      {typeof onBlock === 'function' && (
        <button type="button" onClick={onBlock}>Block Chatforia account</button>
      )}
    </div>
  ),
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
      {msg?.deletedForAll
        ? 'This message was deleted'
        : (
          <>
            {msg?.decryptedContent || msg?.translatedForMe || msg?.rawContent || msg?.content}
            {(msg?.attachments?.length || msg?.attachmentsInline?.length)
              ? <span data-testid="attachment-preview">Photo attachment</span>
              : null}
          </>
        )}
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
import ChatView, {
  formatCallStartError,
} from '../src/components/ChatView.jsx';
import { useSocket } from '@/context/SocketContext';
import axiosClient from '@/api/axiosClient';
import { notifications } from '@mantine/notifications';
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


const deletionPhoto = {
  id: 90001,
  chatRoomId: 10,
  sender: { id: 68, username: 'papi' },
  content: 'Photo before deletion',
  createdAt: '2026-10-28T19:30:00.000Z',
  attachments: [
    {
      id: 288,
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      url: 'uploads/u68/deletion-qa.jpg',
    },
  ],
};

async function mountDeletionPhoto() {
  fetchLatestMessages.mockResolvedValue({
    items: [deletionPhoto],
    nextCursor: null,
  });

  renderWithRouter(
    <ChatView
      currentUserId={1}
      currentUser={{ id: 1 }}
      chatroom={{ id: 10, name: 'Deletion QA' }}
    />
  );

  await waitFor(() => {
    expect(screen.getByText('Photo before deletion')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-preview')).toBeInTheDocument();
  });
}

async function deliverSocketEvent(eventName, payload) {
  const socket = useSocket().socket;

  const callbacks = socket.on.mock.calls
    .filter(([name]) => name === eventName)
    .map(([, callback]) => callback);

  expect(callbacks.length).toBeGreaterThan(0);

  await act(async () => {
    await callbacks[callbacks.length - 1](payload);
  });
}


test('incoming socket messages respect the actual chat viewport', async () => {
  fetchLatestMessages.mockResolvedValueOnce({
    items: [
      {
        id: 99002,
        chatRoomId: 10,
        sender: { id: 2 },
        content: 'Existing message two',
        createdAt: '2026-10-30T12:00:02.000Z',
      },
      {
        id: 99001,
        chatRoomId: 10,
        sender: { id: 2 },
        content: 'Existing message one',
        createdAt: '2026-10-30T12:00:01.000Z',
      },
    ],
    nextCursor: null,
  });

  renderWithRouter(
    <ChatView
      currentUserId={1}
      currentUser={{ id: 1 }}
      chatroom={{ id: 10, name: 'Scroll QA' }}
    />
  );

  await waitFor(() => {
    expect(screen.getByText('Existing message one'))
      .toBeInTheDocument();
    expect(screen.getByText('Existing message two'))
      .toBeInTheDocument();
  });

  const content = document.querySelector(
    '[data-chat-message-content]'
  );

  expect(content).not.toBeNull();

  const viewport = content.parentElement;
  expect(viewport).not.toBeNull();

  let currentTop = 620;
  const assignments = [];

  Object.defineProperties(viewport, {
    scrollHeight: {
      configurable: true,
      get: () => 1000,
    },
    clientHeight: {
      configurable: true,
      get: () => 300,
    },
    scrollTop: {
      configurable: true,
      get: () => currentTop,
      set: (value) => {
        currentTop = value;
        assignments.push(value);
      },
    },
  });

  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  currentTop = 620;
  assignments.length = 0;

  const message = (id) => ({
    id,
    chatRoomId: 10,
    sender: { id: 2 },
    content: `Incoming QA ${id}`,
    createdAt: new Date(Date.UTC(2026, 9, 30, 12, 0, id % 60))
      .toISOString(),
  });

  await deliverSocketEvent('message:upsert', {
    item: message(99101),
  });

  await waitFor(() => {
    expect(screen.getByText('Incoming QA 99101'))
      .toBeInTheDocument();
  });

  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  expect(currentTop).toBe(620);
  expect(assignments).toEqual([]);

  currentTop = 700;
  assignments.length = 0;

  await deliverSocketEvent('message:upsert', {
    item: message(99102),
  });

  await waitFor(() => {
    expect(screen.getByText('Incoming QA 99102'))
      .toBeInTheDocument();
  });

  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  expect(assignments.length).toBeGreaterThan(0);
  expect(currentTop).toBe(1000);
});

test('Delete for everyone removes photo from visible thread', async () => {
  await mountDeletionPhoto();

  await deliverSocketEvent('message:deleted', {
    item: {
      id: 90001,
      chatRoomId: 10,
      deletedForAll: true,
      attachments: [],
    },
  });

  expect(screen.queryByText('This message was deleted'))
    .not.toBeInTheDocument();

  expect(screen.queryByTestId('attachment-preview'))
    .not.toBeInTheDocument();

  expect(screen.queryByText('Photo before deletion'))
    .not.toBeInTheDocument();
});

test('stale upsert cannot resurrect deleted photo', async () => {
  await mountDeletionPhoto();

  await deliverSocketEvent('message:deleted', {
    item: {
      id: 90001,
      chatRoomId: 10,
      deletedForAll: true,
      attachments: [],
    },
  });

  await deliverSocketEvent('message:upsert', {
    item: deletionPhoto,
  });

  expect(screen.queryByText('This message was deleted'))
    .not.toBeInTheDocument();

  expect(screen.queryByTestId('attachment-preview'))
    .not.toBeInTheDocument();
});

test('Delete for me removes photo from this viewer', async () => {
  await mountDeletionPhoto();

  await deliverSocketEvent('message:deleted', {
    item: {
      id: 90001,
      chatRoomId: 10,
      deletedForMe: true,
    },
  });

  expect(screen.queryByText('Photo before deletion'))
    .not.toBeInTheDocument();

  expect(screen.queryByTestId('attachment-preview'))
    .not.toBeInTheDocument();
});

test('formats an active-call conflict for users', () => {
  expect(
    formatCallStartError(
      new Error(
        'CALL_ALREADY_IN_PROGRESS'
      ),
      'Could not start the call.'
    )
  ).toBe(
    'You already have a call in progress. End it before starting another.'
  );
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

test('blocks only after an in-app direct-chat confirmation', async () => {
  renderWithRouter(
    <ChatView
      chatroom={{ id: 10, isGroup: false, participants: [
        { userId: 1 }, { userId: 2, user: { id: 2, username: 'papi' } },
      ] }}
      currentUserId={1}
      currentUser={{ id: 1 }}
    />
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Block Chatforia account' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Block Chatforia account?');
  expect(screen.getByRole('dialog')).toHaveTextContent('papi');
  expect(axiosClient.post).not.toHaveBeenCalledWith('/blocks', expect.anything());
  expect(window.confirm).not.toHaveBeenCalled();
  expect(window.alert).not.toHaveBeenCalled();

  axiosClient.post.mockResolvedValueOnce({ data: { success: true } });
  fireEvent.click(screen.getByRole('button', { name: 'Block account' }));
  await waitFor(() => expect(axiosClient.post).toHaveBeenCalledWith('/blocks', { targetUserId: 2 }));
  await waitFor(() => expect(notifications.show).toHaveBeenCalled());
  expect(window.alert).not.toHaveBeenCalled();
});

test('canceling direct-chat block does not call the API', async () => {
  renderWithRouter(
    <ChatView
      chatroom={{ id: 10, isGroup: false, participants: [{ userId: 1 }, { userId: 2 }] }}
      currentUserId={1} currentUser={{ id: 1 }}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Block Chatforia account' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(axiosClient.post).not.toHaveBeenCalledWith('/blocks', expect.anything());
});

test('group conversations never offer a shortcut that blocks an arbitrary member', async () => {
  renderWithRouter(
    <ChatView
      chatroom={{ id: 10, isGroup: true, participants: [{ userId: 1 }, { userId: 2 }, { userId: 3 }] }}
      currentUserId={1} currentUser={{ id: 1 }}
    />
  );
  expect(await screen.findByTestId('thread-actions-menu')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Block Chatforia account' })).not.toBeInTheDocument();
  expect(axiosClient.post).not.toHaveBeenCalledWith('/blocks', expect.anything());
});

test('Random Chat never shows a generic direct-account Block shortcut', async () => {
  renderWithRouter(
    <ChatView
      chatroom={{ id: 10, isRandom: true, participants: [{ userId: 1 }, { userId: 2 }] }}
      currentUserId={1} currentUser={{ id: 1 }}
    />
  );
  expect(await screen.findByTestId('thread-actions-menu')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Block Chatforia account' })).not.toBeInTheDocument();
});

test('direct conversations with an ambiguous peer never show Block', async () => {
  renderWithRouter(
    <ChatView
      chatroom={{ id: 10, isGroup: false, participants: [{ userId: 1 }, { userId: 2 }, { userId: 3 }] }}
      currentUserId={1} currentUser={{ id: 1 }}
    />
  );
  expect(await screen.findByTestId('thread-actions-menu')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Block Chatforia account' })).not.toBeInTheDocument();
});

test('a failed account block stays open and displays an error', async () => {
  renderWithRouter(
    <ChatView
      chatroom={{ id: 10, isGroup: false, participants: [{ userId: 1 }, { userId: 2 }] }}
      currentUserId={1} currentUser={{ id: 1 }}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Block Chatforia account' }));
  axiosClient.post.mockRejectedValueOnce(new Error('Network unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Block account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not block this account/i);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(window.alert).not.toHaveBeenCalled();
});

const cachedRow = (id, content, revision = 1) => ({
  id, chatRoomId: 10, content, revision, contentCiphertext: `cipher-${id}-${revision}`,
  sender: { id: 2 }, createdAt: `2026-01-01T00:00:${String(id).padStart(2, '0')}.000Z`,
});
const seededNativeCache = (messages) => {
  const cache = createNativeThreadSessionCache('1:key:key');
  cache.putRoom(10, { id: 10 });
  cache.putMessages(10, messages);
  return cache;
};
const deferredNativeRefresh = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('native cached messages appear immediately and an authoritative refresh reconciles edits and deletions', async () => {
  const refresh = deferredNativeRefresh();
  fetchLatestMessages.mockReturnValueOnce(refresh.promise);
  const cache = seededNativeCache([cachedRow(1, 'Old edit'), cachedRow(2, 'Deleted')]);
  renderWithRouter(<ChatView chatroom={{ id: 10 }} currentUserId={1} currentUser={{ id: 1 }} nativeThreadCache={cache} />);
  expect(screen.getByText('Old edit')).toBeInTheDocument();
  expect(screen.getByText('Deleted')).toBeInTheDocument();
  await act(async () => { refresh.resolve({ items: [cachedRow(1, 'Edited', 2)], nextCursor: null }); });
  expect(screen.getByText('Edited')).toBeInTheDocument();
  expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
  expect(cache.getMessages(10).map((message) => message.id)).toEqual([1]);
});

test('failed native refresh removes cached content and online recovery retries', async () => {
  const refresh = deferredNativeRefresh();
  fetchLatestMessages.mockReturnValueOnce(refresh.promise)
    .mockResolvedValueOnce({ items: [cachedRow(3, 'Recovered')], nextCursor: null });
  const cache = seededNativeCache([cachedRow(1, 'Private cached text')]);
  renderWithRouter(<ChatView chatroom={{ id: 10 }} currentUserId={1} currentUser={{ id: 1 }} nativeThreadCache={cache} />);
  expect(screen.getByText('Private cached text')).toBeInTheDocument();
  act(() => window.dispatchEvent(new Event('online')));
  await act(async () => { refresh.reject(new Error('offline')); });
  expect(await screen.findByText('Recovered')).toBeInTheDocument();
  expect(screen.queryByText('Private cached text')).not.toBeInTheDocument();
  expect(fetchLatestMessages).toHaveBeenCalledTimes(2);
});

test('a realtime native message received during refresh survives the response', async () => {
  const refresh = deferredNativeRefresh();
  fetchLatestMessages.mockReturnValueOnce(refresh.promise);
  const cache = seededNativeCache([cachedRow(1, 'Already here')]);
  renderWithRouter(<ChatView chatroom={{ id: 10 }} currentUserId={1} currentUser={{ id: 1 }} nativeThreadCache={cache} />);
  await waitFor(() => expect(useSocket().socket.on.mock.calls.some(([name]) => name === 'message:upsert')).toBe(true));
  await deliverSocketEvent('message:upsert', { chatRoomId: 10, item: cachedRow(2, 'Realtime') });
  await act(async () => { refresh.resolve({ items: [cachedRow(1, 'Already here')], nextCursor: null }); });
  expect(screen.getByText('Realtime')).toBeInTheDocument();
  await waitFor(() => expect(cache.getMessages(10).map((message) => message.id)).toEqual([1, 2]));
});

test('a deletion during native refresh cannot be resurrected by its older response', async () => {
  const refresh = deferredNativeRefresh();
  fetchLatestMessages.mockReturnValueOnce(refresh.promise);
  const cache = seededNativeCache([cachedRow(1, 'Delete me')]);
  renderWithRouter(<ChatView chatroom={{ id: 10 }} currentUserId={1} currentUser={{ id: 1 }} nativeThreadCache={cache} />);
  expect(screen.getByText('Delete me')).toBeInTheDocument();
  await deliverSocketEvent('message:deleted', { item: { id: 1, chatRoomId: 10, deletedForAll: true } });
  await act(async () => { refresh.resolve({ items: [cachedRow(1, 'Delete me')], nextCursor: null }); });
  expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
  expect(cache.getMessages(10)).toEqual([]);
});

test.each([401, 403, 404])('native message refresh %s removes cached content and reports access loss', async (status) => {
  const refresh = deferredNativeRefresh();
  fetchLatestMessages.mockReturnValueOnce(refresh.promise);
  const cache = seededNativeCache([cachedRow(1, 'Private cached text')]);
  const onAccessError = jest.fn();
  renderWithRouter(<ChatView chatroom={{ id: 10 }} currentUserId={1} currentUser={{ id: 1 }} nativeThreadCache={cache} onAccessError={onAccessError} />);
  expect(screen.getByText('Private cached text')).toBeInTheDocument();
  await act(async () => { refresh.reject({ response: { status } }); });
  expect(screen.queryByText('Private cached text')).not.toBeInTheDocument();
  expect(cache.getMessages(10)).toBeNull();
  expect(onAccessError).toHaveBeenCalledTimes(1);
});

test('socket reconnection reconciles missed edits and deletions from authoritative history', async () => {
  fetchLatestMessages.mockResolvedValueOnce({
    items: [cachedRow(2, 'Deleted while offline'), cachedRow(1, 'Original')], nextCursor: null,
  }).mockResolvedValueOnce({
    items: [cachedRow(1, 'Edited while offline', 2)], nextCursor: null,
  });
  renderWithRouter(<ChatView chatroom={{ id: 10 }} currentUserId={1} currentUser={{ id: 1 }} />);
  expect(await screen.findByText('Original')).toBeInTheDocument();
  expect(screen.getByText('Deleted while offline')).toBeInTheDocument();
  await deliverSocketEvent('connect', {});
  expect(await screen.findByText('Edited while offline')).toBeInTheDocument();
  expect(screen.queryByText('Deleted while offline')).not.toBeInTheDocument();
  expect(fetchLatestMessages).toHaveBeenCalledTimes(2);
});

test('browser online recovery refreshes an already loaded native room without duplicate socket fetch', async () => {
  const refresh = deferredNativeRefresh();
  fetchLatestMessages.mockResolvedValueOnce({
    items: [cachedRow(2, 'Removed offline'), cachedRow(1, 'Before offline')], nextCursor: null,
  }).mockReturnValueOnce(refresh.promise);
  renderWithRouter(<ChatView chatroom={{ id: 10 }} currentUserId={1} currentUser={{ id: 1 }} />);
  expect(await screen.findByText('Before offline')).toBeInTheDocument();
  act(() => window.dispatchEvent(new Event('online')));
  await deliverSocketEvent('connect', {});
  await act(async () => { refresh.resolve({ items: [cachedRow(1, 'After offline', 2)], nextCursor: null }); });
  expect(screen.getByText('After offline')).toBeInTheDocument();
  expect(screen.queryByText('Removed offline')).not.toBeInTheDocument();
  expect(fetchLatestMessages).toHaveBeenCalledTimes(2);
});

test('rapid native A → B → A restores confirmed A messages before its return fetch completes', async () => {
  const cache = seededNativeCache([cachedRow(1, 'Confirmed A')]);
  cache.putRoom(20, { id: 20 });
  cache.putMessages(20, [{ ...cachedRow(2, 'Confirmed B'), chatRoomId: 20 }]);
  const pending = [];
  fetchLatestMessages.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  function Harness() {
    const [id, setId] = React.useState(10);
    return <>
      <button type="button" onClick={() => setId(10)}>Room A</button>
      <button type="button" onClick={() => setId(20)}>Room B</button>
      <ChatView key={id} chatroom={{ id }} currentUserId={1} currentUser={{ id: 1 }} nativeThreadCache={cache} />
    </>;
  }
  renderWithRouter(<Harness />);
  expect(screen.getByText('Confirmed A')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Room B' }));
  expect(screen.getByText('Confirmed B')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Room A' }));
  expect(screen.getByText('Confirmed A')).toBeInTheDocument();
  expect(screen.queryByText('Confirmed B')).not.toBeInTheDocument();
  expect(fetchLatestMessages).toHaveBeenCalledTimes(3);
  await act(async () => pending.forEach((resolve) => resolve({ items: [], nextCursor: null })));
});
