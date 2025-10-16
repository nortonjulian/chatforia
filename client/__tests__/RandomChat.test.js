import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import path from 'path';

// -------------------- Mocks (non-hoisted via doMock) --------------------

// Mantine primitives -> simple HTML
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Noop = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Button = ({ children, onClick, disabled, ...p }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...p}>
      {children}
    </button>
  );
  const TextInput = ({ value, onChange, onKeyDown, placeholder, style }) => (
    <input
      aria-label={placeholder || 'input'}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      style={style}
    />
  );
  // Keep API shape: viewportRef gets assigned a DOM ref to the inner container
  const ScrollArea = ({ children, viewportRef, ...p }) => (
    <div data-testid="scrollarea" ref={viewportRef} {...p}>
      {children}
    </div>
  );
  const Badge = ({ children, ...p }) => (
    <span data-testid="badge" {...p}>
      {children}
    </span>
  );
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  const Title = ({ children, ...p }) => <h2 {...p}>{children}</h2>;
  const Box = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Tooltip = ({ children }) => <>{children}</>;
  return {
    Box,
    Paper: Noop,
    Title,
    Text,
    Button,
    Group: Noop,
    TextInput,
    ScrollArea,
    Stack: Noop,
    Badge,
    Tooltip,
  };
});

// Socket mock with event map
const handlers = {};
const mockSocket = {
  on: jest.fn((event, cb) => {
    handlers[event] = cb;
  }),
  off: jest.fn((event, cb) => {
    if (handlers[event] === cb) delete handlers[event];
  }),
  emit: jest.fn(),
};

// axios client (used for save)
const mockPost = jest.fn();

// window.alert
const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

// -------------------- Load SUT after dynamic mocks --------------------
let RandomChat;

beforeAll(() => {

  // Real locations (your socket is in src/lib)
  const socketModulePath = path.resolve(__dirname, '../src/lib/socket');
  const axiosModulePath = path.resolve(__dirname, '../src/api/axiosClient');

  // Mock BEFORE requiring the SUT
  jest.doMock(socketModulePath, () => mockSocket, { virtual: false });
  jest.doMock(
    axiosModulePath,
    () => ({ __esModule: true, default: { post: (...a) => mockPost(...a) } }),
    { virtual: false }
  );

  const randomChatPath = path.resolve(__dirname, '../src/components/RandomChat.jsx');
  // eslint-disable-next-line global-require
  RandomChat = require(randomChatPath).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
});

// -------------------- Helpers --------------------
const me = { id: 'me-1', username: 'Me' };

function pairFound({ roomId = 123, partner = 'Alice', partnerId = 'u-2' } = {}) {
  handlers['pair_found']?.({ roomId, partner, partnerId });
}

function receiveMessage({
  roomId = 123,
  senderId = 'u-2',
  content = 'hi',
  sender = { id: 'u-2', username: 'Alice' },
} = {}) {
  handlers['receive_message']?.({
    content,
    senderId,
    randomChatRoomId: roomId,
    sender,
    createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
  });
}

// -------------------- Tests --------------------
describe('RandomChat', () => {
  test('on mount emits find_random_chat and handles waiting/no_partner (AI offer)', () => {
    render(<RandomChat currentUser={me} />);

    expect(mockSocket.emit).toHaveBeenCalledWith('find_random_chat');

    // waiting
    handlers['waiting']?.('Queueing up…');
    expect(screen.getByText(/queueing up/i)).toBeInTheDocument();

    // no_partner -> status + AI offer button
    handlers['no_partner']?.({ message: 'No partner now.' });
    expect(screen.getByText(/no partner now/i)).toBeInTheDocument();
    const aiBtn = screen.getByRole('button', { name: /chat with foriabot/i });
    expect(aiBtn).toBeInTheDocument();

    // Start AI -> emits, status, clears messages
    handlers['receive_message']?.({ randomChatRoomId: 'ai-room', content: 'temp' });
    fireEvent.click(aiBtn);
    expect(mockSocket.emit).toHaveBeenCalledWith('start_ai_chat');
    expect(screen.getByText(/connected to foriabot/i)).toBeInTheDocument();
    expect(screen.queryByText('temp')).not.toBeInTheDocument();
  });

  test('pair_found shows badge, enables composer; Send button enables with text and sends optimistically', () => {
    render(<RandomChat currentUser={me} />);

    pairFound(); // room 123, Alice

    // Badge shows partner name
    expect(screen.getByTestId('badge')).toHaveTextContent('Alice');

    const input = screen.getByLabelText(/type a message/i);
    const send = screen.getByRole('button', { name: /^send$/i });
    // Empty -> disabled
    expect(send).toBeDisabled();

    // Type and send
    fireEvent.change(input, { target: { value: '  hello  ' } });
    expect(send).not.toBeDisabled();

    fireEvent.click(send);

    // socket emit with outgoing payload
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({
        content: 'hello',
        senderId: 'me-1',
        randomChatRoomId: 123,
      })
    );

    // Optimistic message appears with "You"
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();

    // Input cleared
    expect(input.value).toBe('');
  });

  test('Enter key (without Shift) triggers send', () => {
    render(<RandomChat currentUser={me} />);
    pairFound();

    const input = screen.getByLabelText(/type a message/i);
    fireEvent.change(input, { target: { value: 'enter send' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: false });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({
        content: 'enter send',
      })
    );
    expect(input.value).toBe('');
  });

  test('receive_message appends only for current roomId and renders partner bubble', () => {
    render(<RandomChat currentUser={me} />);
    pairFound({ roomId: 456, partner: 'Bob', partnerId: 'u-9' });

    // Mismatched room -> ignored
    receiveMessage({ roomId: 999, content: 'wrong room' });
    expect(screen.queryByText('wrong room')).not.toBeInTheDocument();

    // Correct room -> shown
    receiveMessage({
      roomId: 456,
      content: 'hey there',
      sender: { id: 'u-9', username: 'Bob' },
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('hey there')).toBeInTheDocument();
  });

  test('Skip emits skip_random_chat and clears state', () => {
    render(<RandomChat currentUser={me} />);
    pairFound();

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(mockSocket.emit).toHaveBeenCalledWith('skip_random_chat');

    // Composer should disappear (no Send)
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
  });

  test('partner_disconnected clears session and hides AI offer', () => {
    render(<RandomChat currentUser={me} />);
    pairFound();

    handlers['partner_disconnected']?.('Partner left.');
    expect(screen.getByText(/partner left/i)).toBeInTheDocument();

    // Composer gone
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
    // AI offer should be false after disconnect
    expect(screen.queryByRole('button', { name: /foriabot/i })).not.toBeInTheDocument();
  });

  test('chat_skipped resets state, status updates', () => {
    render(<RandomChat currentUser={me} />);
    pairFound();
    handlers['chat_skipped']?.('Stopped.');
    expect(screen.getByText(/stopped/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
  });

  test('Save is enabled for human-to-human and posts messages', async () => {
    render(<RandomChat currentUser={me} />);
    pairFound({ roomId: 77, partner: 'Dana', partnerId: 'u-44' });

    // Add some messages (one from me, one from partner)
    // Send from me
    const input = screen.getByLabelText(/type a message/i);
    fireEvent.change(input, { target: { value: 'my msg' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // Receive from partner
    receiveMessage({
      roomId: 77,
      content: 'their msg',
      senderId: 'u-44',
      sender: { id: 'u-44', username: 'Dana' },
    });

    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    // Click Save
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/random-chats',
        expect.objectContaining({
          participants: ['me-1', 'u-44'],
          messages: expect.arrayContaining([
            expect.objectContaining({ content: 'my msg', senderId: 'me-1' }),
            expect.objectContaining({ content: 'their msg', senderId: 'u-44' }),
          ]),
        })
      );
    });

    expect(alertSpy).toHaveBeenCalledWith('Chat saved!');
  });

  test('Save shows failure alert when API errors', async () => {
    render(<RandomChat currentUser={me} />);
    pairFound({ roomId: 42, partnerId: 'u-2' });

    mockPost.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to save chat');
    });
  });

  test('Save disabled for AI (string roomId) or missing partnerId', () => {
    const { rerender } = render(<RandomChat currentUser={me} />);
    // Pair with string room id (simulate a non-human/AI case)
    pairFound({ roomId: 'ai-123', partner: 'ForiaBot', partnerId: null });
    // Composer only renders when roomId truthy; here it is, but Save must be disabled per prop
    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    expect(saveBtn).toBeDisabled();
    expect(saveBtn).toHaveAttribute(
      'title',
      expect.stringMatching(/only human-to-human/i)
    );

    // If numeric room but missing partnerId, disabled too
    rerender(<RandomChat currentUser={me} />);
    pairFound({ roomId: 9, partnerId: null });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  test('auto-scrolls to end on new messages', () => {
    // Spy on scrollIntoView of the sentinel
    const scrollSpy = jest.fn();
    render(<RandomChat currentUser={me} />);
    pairFound();

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });

    receiveMessage({ roomId: 123, content: 'scroll me' });
    expect(scrollSpy).toHaveBeenCalled();
  });
});
