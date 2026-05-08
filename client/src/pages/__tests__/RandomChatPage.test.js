import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RandomChatPage from '../RandomChatPage.jsx';

/* ---------------- Mantine mock ---------------- */
jest.mock('@mantine/core', () => {
  const React = require('react');

  const passthrough =
    (Tag = 'div', testId) =>
    ({ children, leftSection, rightSection, ...props }) => (
      <Tag data-testid={testId} {...props}>
        {leftSection}
        {children}
        {rightSection}
      </Tag>
    );

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
  on: jest.fn((event, callback) => {
    socketHandlers[event] = callback;
  }),
  emit: mockEmit,
  disconnect: mockDisconnect,
  removeAllListeners: mockRemoveAllListeners,
};

jest.mock('socket.io-client', () => ({
  __esModule: true,
  io: jest.fn(() => mockSocket),
}));

function triggerSocket(event, payload) {
  act(() => {
    socketHandlers[event]?.(payload);
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  Object.keys(socketHandlers).forEach((key) => {
    delete socketHandlers[key];
  });

  localStorage.clear();

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      user: {
        ageBand: '18-24',
        wantsAgeFilter: false,
      },
    }),
  });

  Element.prototype.scrollIntoView = jest.fn();
});

describe('RandomChatPage', () => {
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

    expect(mockEmit).toHaveBeenCalledWith('random:join', {});
    expect(screen.getByText(/matching/i)).toBeInTheDocument();
  });

  test('starting Ria chat emits random:ai_start', async () => {
    render(<RandomChatPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: /chat with ria/i })
    );

    expect(mockEmit).toHaveBeenCalledWith('random:ai_start');
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

  test('sending a message emits random:message and clears input', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-2',
      myAlias: 'You',
      partnerAlias: 'Alex',
    });

    const input = await screen.findByPlaceholderText(/message your match/i);
    const sendButton = screen.getByRole('button', { name: /send message/i });

    expect(sendButton).toBeDisabled();

    fireEvent.change(input, { target: { value: '  hello there  ' } });

    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);

    expect(mockEmit).toHaveBeenCalledWith('random:message', {
      roomId: 'room-2',
      content: 'hello there',
    });

    await waitFor(() => {
      expect(input).toHaveValue('');
    });

    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  test('random:message appends incoming message', async () => {
    render(<RandomChatPage />);

    triggerSocket('random:matched', {
      roomId: 'room-3',
      myAlias: 'You',
      partnerAlias: 'Casey',
    });

    triggerSocket('random:message', {
      id: 'msg-1',
      senderId: 999,
      sender: { username: 'Casey' },
      content: 'hi from partner',
      createdAt: new Date().toISOString(),
    });

    expect(await screen.findByText('hi from partner')).toBeInTheDocument();
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
      reason: 'peer_skipped',
    });

    expect(
      (await screen.findAllByText(/the other person moved on/i)).length
    ).toBeGreaterThan(0);

    expect(
      screen.getByRole('button', { name: /find me a match/i })
    ).toBeInTheDocument();
  });
});