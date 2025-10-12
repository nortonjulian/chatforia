import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mocks ----

// Minimal Mantine stubs
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Button = ({ children, onClick, disabled, ...rest }) => (
    <button onClick={onClick} disabled={!!disabled} {...rest}>{children}</button>
  );
  const TextInput = ({ value, onChange, placeholder, ...rest }) => (
    <input
      data-testid="draft-input"
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder || ''}
      {...rest}
    />
  );
  const Badge = ({ children, ...rest }) => <span data-testid="badge" {...rest}>{children}</span>;
  const Loader = (p) => <span data-testid="loader">loader</span>;

  return {
    __esModule: true,
    Paper: passthru('paper'),
    Title: passthru('title'),
    Text: passthru('text'),
    Button,
    Group: passthru('group'),
    Loader,
    TextInput,
    Stack: passthru('stack'),
    Badge,
    Card: passthru('card'),
  };
});

// Icons (not relevant to logic)
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconMessageCircle: () => <i data-testid="icon-msg" />,
  IconPlayerPlay:   () => <i data-testid="icon-play" />,
  IconPlayerStop:   () => <i data-testid="icon-stop" />,
  IconRobot:        () => <i data-testid="icon-robot" />,
}));

// User context with a stable currentUser
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 42, username: 'me' } }),
}));

// Socket singleton mock (basic event emitter surface)
const serverEmitMock = jest.fn();
const handlers = {};
const socketMock = {
  on: (evt, cb) => {
    (handlers[evt] ||= new Set()).add(cb);
  },
  off: (evt, cb) => {
    if (handlers[evt]) handlers[evt].delete(cb);
  },
  emit: serverEmitMock, // client -> server emits (spy on calls)
  __trigger: (evt, ...args) => {
    (handlers[evt] || []).forEach((cb) => cb(...args));
  },
};
jest.mock('@/lib/socket', () => socketMock);

// SUT
import RandomChatPage from './RandomChatPage';

describe('RandomChatPage', () => {
  beforeEach(() => {
    serverEmitMock.mockReset();
    // clear any registered handlers between tests
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  test('initial UI shows Idle badge and action buttons', () => {
    render(<RandomChatPage />);

    expect(screen.getByText(/Random Chat/i)).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);

    expect(screen.getByText(/Find me a match/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancel/i)).toBeInTheDocument();
    expect(screen.getByText(/Chat with Foria/i)).toBeInTheDocument();
  });

  test('starting a search emits find_random_chat and shows Searching badge + status', () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Find me a match/i));

    expect(serverEmitMock).toHaveBeenCalledWith('find_random_chat');
    // Searching badge appears
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching…/i);
    // Status text appears
    expect(screen.getByText(/Looking for someone…/i)).toBeInTheDocument();
  });

  test('starting an AI chat emits start_ai_chat and will normalize next pair_found to "Foria" with BOT badge', () => {
    render(<RandomChatPage />);
    // Start AI chat
    fireEvent.click(screen.getByText(/Chat with Foria/i));
    expect(serverEmitMock).toHaveBeenCalledWith('start_ai_chat');
    expect(screen.getByText(/Starting a chat with Foria/i)).toBeInTheDocument();

    // Trigger pair_found with a plain payload (no AI flags)
    socketMock.__trigger('pair_found', { roomId: 'r1', partner: 'Somebody' });

    // Active state UI
    expect(screen.getByTestId('badge')).toHaveTextContent(/With Foria/i);
    expect(screen.getByText(/You’re chatting with Foria/i)).toBeInTheDocument();
    // BOT badge present
    expect(screen.getByText(/BOT/i)).toBeInTheDocument();

    // Messages panel shows empty prompt initially
    expect(screen.getByText(/Say hi/i)).toBeInTheDocument();
  });

  test('pair_found (human) shows Connected badge and partner name in header', () => {
    render(<RandomChatPage />);

    // Go searching first
    fireEvent.click(screen.getByText(/Find me a match/i));
    // Then server finds a partner
    socketMock.__trigger('pair_found', { roomId: 'room-7', partner: 'Sam' });

    expect(screen.getByTestId('badge')).toHaveTextContent(/Connected/i);
    expect(screen.getByText(/You’re chatting with Sam/i)).toBeInTheDocument();
    // No BOT badge
    expect(screen.queryByText(/BOT/)).toBeNull();
  });

  test('sending messages: trims content, uses active.roomId, clears input, and disables button when blank', () => {
    render(<RandomChatPage />);

    // Activate a room
    socketMock.__trigger('pair_found', { roomId: 'xyz', partner: 'Alex' });

    const input = screen.getByTestId('draft-input');
    const sendBtn = screen.getByText(/^Send$/i);

    // Initially blank -> disabled
    expect(sendBtn).toBeDisabled();

    // Type whitespace -> still disabled
    fireEvent.change(input, { target: { value: '   ' } });
    expect(sendBtn).toBeDisabled();

    // Type a message with spaces -> enabled
    fireEvent.change(input, { target: { value: '  hello there  ' } });
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);

    expect(serverEmitMock).toHaveBeenCalledWith('send_message', {
      content: 'hello there',
      randomChatRoomId: 'xyz',
    });

    // Input cleared and disabled again
    expect(input).toHaveValue('');
    expect(sendBtn).toBeDisabled();
  });

  test('receive_message appends; label shows "You" for self and partner label for others', () => {
    render(<RandomChatPage />);

    // Active with human partner "Casey"
    socketMock.__trigger('pair_found', { roomId: 'r2', partner: 'Casey' });

    // Partner message
    socketMock.__trigger('receive_message', {
      senderId: 999,
      content: 'hi from partner',
    });
    // Self message (senderId matches currentUser.id)
    socketMock.__trigger('receive_message', {
      senderId: 42,
      content: 'my reply',
    });

    // Two messages now
    expect(screen.getByText('Casey')).toBeInTheDocument();
    expect(screen.getByText('hi from partner')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('my reply')).toBeInTheDocument();
  });

  test('partner_disconnected shows status text; chat_skipped resets to Idle with status', () => {
    render(<RandomChatPage />);

    // Active
    socketMock.__trigger('pair_found', { roomId: 'r3', partner: 'Ava' });
    // Partner disconnects with custom message
    socketMock.__trigger('partner_disconnected', 'They left.');
    expect(screen.getByText(/They left\./i)).toBeInTheDocument();

    // Server says chat was skipped/stopped
    socketMock.__trigger('chat_skipped', 'Stopped.');
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
    expect(screen.getByText(/Stopped\./i)).toBeInTheDocument();
  });

  test('Cancel button (and ESC) call skip_random_chat and reset UI', () => {
    render(<RandomChatPage />);

    // Start a search to change state
    fireEvent.click(screen.getByText(/Find me a match/i));
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching/i);

    // Click Cancel -> should emit skip and return to Idle
    fireEvent.click(screen.getByText(/^Cancel$/i));
    expect(serverEmitMock).toHaveBeenCalledWith('skip_random_chat');
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
    expect(screen.getByText(/Cancelled\./i)).toBeInTheDocument();

    // Start again and test ESC shortcut
    fireEvent.click(screen.getByText(/Find me a match/i));
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching/i);
    // ESC keydown
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(serverEmitMock).toHaveBeenCalledWith('skip_random_chat');
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
    expect(screen.getByText(/Cancelled\./i)).toBeInTheDocument();
  });

  test('AI flow + receive_message uses partner label "Foria"', () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Chat with Foria/i));
    socketMock.__trigger('pair_found', { roomId: 'r-bot', partner: 'whatever' });

    // Partner label normalized
    expect(screen.getByText(/You’re chatting with Foria/i)).toBeInTheDocument();

    // Message from "bot" (no senderId == current user) uses "Foria" label
    socketMock.__trigger('receive_message', { senderId: 999, content: 'I am an AI.' });
    expect(screen.getByText('Foria')).toBeInTheDocument();
    expect(screen.getByText('I am an AI.')).toBeInTheDocument();
  });
});
