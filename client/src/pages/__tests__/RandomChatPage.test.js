import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RandomChatPage from '../RandomChatPage.jsx';

const mockGetProfile = jest.fn();
const mockPostMessage = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => mockGetProfile(...args), post: (...args) => mockPostMessage(...args) },
}));
jest.mock('@/lib/api', () => ({ fetchLatestMessages: jest.fn(async () => ({ items: [] })) }));
jest.mock('@/utils/loadEncryptionClient', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ decryptFetchedMessages: async (rows) => rows })),
}));
jest.mock('@/utils/encryptionClient', () => ({
  encryptForSingleUser: jest.fn(async () => ({ contentCiphertext: 'cipher', encryptedKey: 'key' })),
}));

/* ---------------- Mantine mock ---------------- */
jest.mock('@mantine/core', () => {
  const React = require('react');

  const passthrough = (Tag = 'div', testId) => {
    function MockMantineComponent({ children, leftSection, rightSection, ...props }) {
      return (
        <Tag data-testid={testId} {...props}>
          {leftSection}
          {children}
          {rightSection}
        </Tag>
      );
    }
    return MockMantineComponent;
  };

  return {
    __esModule: true,
    ActionIcon: ({ children, disabled, onClick, ...props }) => (
      <button type="button" disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Alert: ({ children, title, ...props }) => (
      <div role="alert" {...props}>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    ),
    Badge: passthrough('span', 'badge'),
    Box: passthrough('div', 'box'),
    Button: ({ children, leftSection, disabled, loading, onClick, ...props }) => (
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onClick}
        {...props}
      >
        {leftSection}
        {children}
      </button>
    ),
    Card: passthrough('div', 'card'),
    Group: passthrough('div', 'group'),
    Loader: () => <span data-testid="loader">Loading…</span>,
    ScrollArea: passthrough('div', 'scroll-area'),
    Stack: passthrough('div', 'stack'),
    Text: passthrough('p', 'text'),
    TextInput: ({
      value,
      onChange,
      onKeyDown,
      placeholder,
      disabled,
      ...props
    }) => (
      <input
        aria-label={placeholder || 'message'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        disabled={disabled}
        {...props}
      />
    ),
    Title: ({ children, order, ...props }) => <h2 {...props}>{children}</h2>,
  };
});

/* ---------------- Icons mock ---------------- */
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconArrowRight: () => <i />,
  IconRobot: () => <i />,
  IconRefresh: () => <i />,
  IconUserPlus: () => <i />,
  IconX: () => <i />,
}));

/* ---------------- Router mock ---------------- */
const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

/* ---------------- i18n mock ---------------- */
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

/* ---------------- Config mock ---------------- */
jest.mock('@/config', () => ({
  __esModule: true,
  WS_URL: 'http://localhost:3000',
}));

/* ---------------- socket.io-client mock ---------------- */
const socketHandlers = {};
const mockEmit = jest.fn();
const mockDisconnect = jest.fn();
const mockRemoveAllListeners = jest.fn();

const mockSocket = {
  connected: false,
  on: jest.fn((event, callback) => {
    socketHandlers[event] = callback;
  }),
  off: jest.fn((event, callback) => {
    if (socketHandlers[event] === callback) delete socketHandlers[event];
  }),
  emit: mockEmit,
  disconnect: mockDisconnect,
  removeAllListeners: mockRemoveAllListeners,
};

jest.mock('@/context/SocketContext', () => ({ useSocket: () => ({ socket: mockSocket }) }));

function triggerSocket(event, payload) {
  act(() => {
    socketHandlers[event]?.(payload);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSocket.connected = false;

  Object.keys(socketHandlers).forEach((key) => {
    delete socketHandlers[key];
  });

  localStorage.clear();

  mockGetProfile.mockResolvedValue({
    data: { user: {
      id: 1,
      publicKey: 'local-key',
      ageBand: 'ADULT_18_24',
      wantsAgeFilter: false,
    } },
  });
  mockPostMessage.mockResolvedValue({ data: { message: { id: 44, chatRoomId: 2, senderId: 1 } } });

  Element.prototype.scrollIntoView = jest.fn();
});

describe('RandomChatPage', () => {
  test('loads age from the authenticated API rather than the site origin', async () => {
    render(<RandomChatPage />);
    await waitFor(() => {
      expect(mockGetProfile).toHaveBeenCalledWith('/auth/me');
      expect(screen.getByRole('button', { name: /find me a match/i })).toBeEnabled();
    });
  });

  test('a profile fetch failure never masquerades as an unset age', async () => {
    mockGetProfile.mockRejectedValueOnce(new Error('Network error'));
    render(<RandomChatPage />);
    await waitFor(() => {
      expect(screen.getByText(/could not verify your age range/i)).toBeInTheDocument();
    });
  });

  test('initial UI shows Idle badge and action buttons', async () => {
    render(<RandomChatPage />);

    expect(
      screen.getByRole('heading', { name: /random chat/i })
    ).toBeInTheDocument();

    expect(screen.getByText(/idle/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /find me a match/i })
      ).toBeEnabled();
    });

    expect(
      screen.getByRole('button', { name: /chat with ria/i })
    ).toBeInTheDocument();
  });

  test('starting a human match emits random:join', async () => {
    render(<RandomChatPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /find me a match/i })
      ).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /find me a match/i }));

    expect(mockEmit).toHaveBeenCalledWith('random:join',
      expect.objectContaining({ requestId: expect.any(String) }));
    expect(screen.getByText(/matching/i)).toBeInTheDocument();
    const requestId = mockEmit.mock.calls.find(([event]) => event === 'random:join')[1].requestId;
    triggerSocket('random:resumed', {
      roomId: 27, chatRoomId: 27, requestId,
      myAlias: 'Quiet Signal', partnerAlias: 'Bright Wave',
    });
    expect(await screen.findByText('Bright Wave')).toBeInTheDocument();
  });

  test('starting Ria chat emits random:ai_start', async () => {
    render(<RandomChatPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: /chat with ria/i })
    );

    expect(mockEmit).toHaveBeenCalledWith('random:ai_start');
  });

  test('age attestation rejection ends searching and asks for profile confirmation', async () => {
    render(<RandomChatPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /find me a match/i })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /find me a match/i }));

    triggerSocket('random:error', { code: 'AGE_ATTESTATION_REQUIRED' });

    expect(screen.getByText(/confirm your age range/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find me a match/i })).toBeDisabled();
  });

  test('blocked pairing rejection resets UI without revealing the blocked identity', async () => {
    render(<RandomChatPage />);
    triggerSocket('random:matched', {
      roomId: 'room-blocked',
      myAlias: 'You',
      partnerAlias: 'Someone',
    });

    triggerSocket('random:error', { code: 'ACCOUNT_BLOCKED' });

    expect(screen.getByText(/this conversation is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find me a match/i })).toBeInTheDocument();
    expect(screen.queryByText(/you matched with someone/i)).not.toBeInTheDocument();
  });

  test('invalid room message rejection returns user to start screen', async () => {
    render(<RandomChatPage />);
    triggerSocket('random:matched', {
      roomId: 'expired-room',
      myAlias: 'You',
      partnerAlias: 'Alex',
    });

    triggerSocket('random:error', { code: 'NOT_IN_ACTIVE_SESSION' });

    expect(screen.getByText(/this chat session is no longer active/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find me a match/i })).toBeInTheDocument();
  });

  test('random:matched opens human chat pane', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-1',
      myAlias: 'You',
      partnerAlias: 'Sam',
    });

    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.getByText(/anonymous/i)).toBeInTheDocument();
    expect(screen.getByText(/you matched with sam/i)).toBeInTheDocument();
  });

  test('random:ai_started opens Ria chat pane', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:ai_started', {
      roomId: 'ria-room',
      name: 'Ria',
    });

    expect(await screen.findByText('Ria')).toBeInTheDocument();
    expect(screen.getByText(/ai/i)).toBeInTheDocument();
    expect(screen.getByText(/now chatting with ria/i)).toBeInTheDocument();
  });

  test('sending a human message persists encrypted payloads for both participants', async () => {
    mockGetProfile.mockImplementation(async (path) => path === '/auth/me'
      ? { data: { user: { id: 1, publicKey: 'local-key', ageBand: 'ADULT_18_24' } } }
      : { data: { participants: [
        { user: { id: 1, publicKey: 'local-key' } },
        { user: { id: 2, publicKey: 'peer-key' } },
      ] } });
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 2,
      chatRoomId: 2,
      myAlias: 'You',
      partnerAlias: 'Alex',
    });

    const input = await screen.findByPlaceholderText(/message your match/i);
    const sendButton = screen.getByRole('button', { name: /send message/i });

    expect(sendButton).toBeDisabled();

    fireEvent.change(input, { target: { value: '  hello there  ' } });

    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);

    await waitFor(() => expect(mockPostMessage).toHaveBeenCalledWith('/messages',
      expect.objectContaining({
        chatRoomId: 2,
        content: null,
        encryptedPayloads: { '1': expect.any(Object), '2': expect.any(Object) },
      })));
    expect(mockEmit).not.toHaveBeenCalledWith('random:message', expect.anything());

    await waitFor(() => {
      expect(input).toHaveValue('');
    });

    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  test('message:upsert appends an incoming persisted message', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 3,
      chatRoomId: 3,
      myAlias: 'You',
      partnerAlias: 'Casey',
    });

    triggerSocket('message:upsert', { item: {
      id: 'msg-1',
      chatRoomId: 3,
      senderId: 2,
      sender: { username: 'Casey' },
      content: 'hi from partner',
      createdAt: new Date().toISOString(),
    } });

    expect(await screen.findByText('hi from partner')).toBeInTheDocument();
  });

  test('sender IDs set direction while aliases remain visible', async () => {
    render(<RandomChatPage />);
    await waitFor(() => expect(mockGetProfile).toHaveBeenCalledWith('/auth/me'));
    triggerSocket('random:matched', {
      roomId: 12, chatRoomId: 12,
      myAlias: 'Quiet Signal', partnerAlias: 'Bright Wave',
    });
    triggerSocket('message:upsert', { item: {
      id: 101, chatRoomId: 12, senderId: 1, content: 'from web',
    } });
    triggerSocket('message:upsert', { item: {
      id: 102, chatRoomId: 12, senderId: 2, content: 'from iOS',
    } });
    expect(await screen.findByText('from web')).toBeInTheDocument();
    expect(await screen.findByText('from iOS')).toBeInTheDocument();
    expect(screen.getByText('Quiet Signal')).toBeInTheDocument();
    expect(screen.getAllByText('Bright Wave').length).toBeGreaterThan(0);
  });

  test('navigation cleanup preserves the shared socket and can restore the match', async () => {
    mockSocket.connected = true;
    const page = render(<RandomChatPage />);
    expect(mockEmit).toHaveBeenCalledWith('random:resume',
      expect.objectContaining({ requestId: expect.any(String) }));
    triggerSocket('random:matched', {
      roomId: 15, chatRoomId: 15, myAlias: 'Quiet Signal', partnerAlias: 'Bright Wave',
    });
    page.unmount();
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(mockSocket.off).toHaveBeenCalled();
    render(<RandomChatPage />);
    const requestId = mockEmit.mock.calls.filter(([event]) => event === 'random:resume').at(-1)[1].requestId;
    triggerSocket('random:resumed', {
      roomId: 15, chatRoomId: 15, requestId,
      myAlias: 'Quiet Signal', partnerAlias: 'Bright Wave',
    });
    expect(await screen.findByText('Bright Wave')).toBeInTheDocument();
  });

  test('reconnect after the grace window shows a single expired state', async () => {
    render(<RandomChatPage />);
    triggerSocket('random:matched', {
      roomId: 16, chatRoomId: 16, myAlias: 'Quiet Signal', partnerAlias: 'Bright Wave',
    });
    triggerSocket('connect');
    const requestId = mockEmit.mock.calls.filter(([event]) => event === 'random:resume').at(-1)[1].requestId;
    triggerSocket('random:none', { requestId });
    expect(await screen.findByText(/chat session expired/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('card')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /find me a match/i })).toBeInTheDocument();
  });

  test('a late or superseded random:none cannot end a newer match', async () => {
    mockSocket.connected = true;
    render(<RandomChatPage />);
    const oldRequestId = mockEmit.mock.calls.find(([event]) => event === 'random:resume')[1].requestId;
    triggerSocket('random:matched', {
      roomId: 17, chatRoomId: 17, myAlias: 'Quiet Signal', partnerAlias: 'Bright Wave',
    });
    triggerSocket('random:none', { requestId: oldRequestId });
    expect(screen.getAllByText('Bright Wave').length).toBeGreaterThan(0);
    triggerSocket('connect');
    const currentRequestId = mockEmit.mock.calls.filter(([event]) => event === 'random:resume').at(-1)[1].requestId;
    triggerSocket('random:none', { requestId: oldRequestId });
    expect(screen.getAllByText('Bright Wave').length).toBeGreaterThan(0);
    triggerSocket('random:resumed', {
      roomId: 99, chatRoomId: 99, myAlias: 'Old Alias', partnerAlias: 'Old Partner',
    });
    expect(screen.getAllByText('Bright Wave').length).toBeGreaterThan(0);
    triggerSocket('random:resumed', {
      roomId: 17, chatRoomId: 17, requestId: currentRequestId,
      myAlias: 'Quiet Signal', partnerAlias: 'Bright Wave',
    });
    triggerSocket('random:none', { requestId: currentRequestId });
    expect(screen.getAllByText('Bright Wave').length).toBeGreaterThan(0);
  });

  test('Add Friend emits random:add_friend and disables request button', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-4',
      myAlias: 'You',
      partnerAlias: 'Taylor',
    });

    const addFriendButton = await screen.findByRole('button', {
      name: /add friend/i,
    });

    fireEvent.click(addFriendButton);

    expect(mockEmit).toHaveBeenCalledWith('random:add_friend', {
      roomId: 'room-4',
    });

    expect(screen.getByRole('button', { name: /requested/i })).toBeDisabled();
    expect(screen.getByText(/friend request sent/i)).toBeInTheDocument();
  });

  test('random:friend_accepted navigates to chat room', async () => {
    jest.useFakeTimers();

    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-5',
      myAlias: 'You',
      partnerAlias: 'Jordan',
    });

    triggerSocket('random:friend_accepted', {
      chatRoomId: 123,
      username: 'jordan',
      userId: 88,
    });

    expect(await screen.findAllByText(/@jordan/i)).toHaveLength(2);

    act(() => {
      jest.advanceTimersByTime(700);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/chat/123');

    jest.useRealTimers();
  });

  test('Next Person emits random:skip', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-6',
      myAlias: 'You',
      partnerAlias: 'Morgan',
    });

    fireEvent.click(await screen.findByRole('button', { name: /next person/i }));

    expect(mockEmit).toHaveBeenCalledWith('random:skip');
  });

  test('Leave emits random:leave and resets UI for human chat', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-7',
      myAlias: 'You',
      partnerAlias: 'Ava',
    });

    fireEvent.click(await screen.findByRole('button', { name: /leave/i }));

    expect(mockEmit).toHaveBeenCalledWith('random:leave');

    expect(
      await screen.findByRole('button', { name: /find me a match/i })
    ).toBeInTheDocument();
  });

  test('random:ended shows ended banner and returns to start card', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-8',
      myAlias: 'You',
      partnerAlias: 'Blake',
    });

    triggerSocket('random:ended', {
      roomId: 'room-8',
      reason: 'peer_skipped',
    });

    expect(
      (await screen.findAllByText(/the other person moved on/i)).length
    ).toBeGreaterThan(0);

    expect(
      screen.getByRole('button', { name: /find me a match/i })
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('card')).toHaveLength(1);
  });
});
