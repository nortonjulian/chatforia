import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* ---------------- Mantine stubs ---------------- */
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
  const Badge  = ({ children, ...rest }) => <span data-testid="badge" {...rest}>{children}</span>;
  const Loader = () => <span data-testid="loader">loader</span>;

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

/* ---------------- Icons stub ---------------- */
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconMessageCircle: () => <i data-testid="icon-msg" />,
  IconPlayerPlay:   () => <i data-testid="icon-play" />,
  IconPlayerStop:   () => <i data-testid="icon-stop" />,
  IconRobot:        () => <i data-testid="icon-robot" />,
}));

/* ---------------- User context stub ---------------- */
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 42, username: 'me' } }),
}));

/* ---------------- Router helpers ---------------- */
jest.mock('react-router-dom', () => {
  return {
    __esModule: true,
    useNavigate: () => jest.fn(),
  };
});

/* ---- Socket singleton mock (robust shared state) ---- */
globalThis.__socketState = globalThis.__socketState || { handlers: {}, emitMock: jest.fn() };
globalThis.__serverEmitMock = globalThis.__socketState.emitMock;

jest.mock('@/lib/socket', () => {
  const getState = () => {
    if (!globalThis.__socketState) {
      globalThis.__socketState = { handlers: {}, emitMock: jest.fn() };
      globalThis.__serverEmitMock = globalThis.__socketState.emitMock;
    }
    return globalThis.__socketState;
  };

  const api = {
    on: (evt, cb) => {
      const { handlers } = getState();
      (handlers[evt] ||= new Set()).add(cb);
    },
    off: (evt, cb) => {
      const { handlers } = getState();
      handlers[evt]?.delete(cb);
    },
    emit: (...args) => getState().emitMock(...args),
    __trigger: (evt, ...args) => {
      const { handlers } = getState();
      (handlers[evt] ?? new Set()).forEach((cb) => cb(...args));
    },
  };

  return { __esModule: true, default: api };
});

// Pull the mocked instance for triggers AFTER the mock above
const socket = require('@/lib/socket').default;

/* ---------------- SUT ---------------- */
import RandomChatPage from '../RandomChatPage';

describe('RandomChatPage', () => {
  beforeEach(() => {
    globalThis.__socketState.emitMock.mockReset();
    globalThis.__socketState.handlers = {};
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

    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith('find_random_chat');
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching…/i);
    expect(screen.getByText(/Looking for someone…/i)).toBeInTheDocument();
  });

  test('starting an AI chat emits start_ai_chat and normalizes next pair_found to "Foria" with BOT badge', async () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Chat with Foria/i));
    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith('start_ai_chat');
    expect(screen.getByText(/Starting a chat with Foria/i)).toBeInTheDocument();

    socket.__trigger('pair_found', { roomId: 'r1', partner: 'Somebody' });

    await waitFor(() => {
      const badges = screen.getAllByTestId('badge');
      expect(badges.some((el) => /With Foria/i.test(el.textContent || ''))).toBe(true);
    });
    expect(screen.getByText(/You’re chatting with Foria/i)).toBeInTheDocument();
    expect(screen.getByText(/BOT/i)).toBeInTheDocument();
    expect(screen.getByText(/Say hi/i)).toBeInTheDocument();
  });

  test('pair_found (human) shows Connected badge and partner name in header', async () => {
    render(<RandomChatPage />);
    fireEvent.click(screen.getByText(/Find me a match/i));

    socket.__trigger('pair_found', { roomId: 'room-7', partner: 'Sam' });

    await waitFor(() => {
      expect(screen.getByTestId('badge')).toHaveTextContent(/Connected/i);
    });
    expect(screen.getByText(/You’re chatting with Sam/i)).toBeInTheDocument();
    expect(screen.queryByText(/BOT/)).toBeNull();
  });

  test('sending messages: trims content, uses active.roomId, clears input, and disables button when blank', async () => {
    render(<RandomChatPage />);

    socket.__trigger('pair_found', { roomId: 'xyz', partner: 'Alex' });

    const input = await screen.findByTestId('draft-input');
    const sendBtn = await screen.findByText(/^Send$/i);

    expect(sendBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '   ' } });
    expect(sendBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '  hello there  ' } });
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);

    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith('send_message', {
      content: 'hello there',
      randomChatRoomId: 'xyz',
    });

    expect(input).toHaveValue('');
    expect(sendBtn).toBeDisabled();
  });

  test('receive_message appends; label shows "You" for self and partner label for others', async () => {
    render(<RandomChatPage />);

    socket.__trigger('pair_found', { roomId: 'r2', partner: 'Casey' });

    socket.__trigger('receive_message', { senderId: 999, content: 'hi from partner' });
    socket.__trigger('receive_message', { senderId: 42,  content: 'my reply' });

    await waitFor(() => {
      expect(screen.getByText('Casey')).toBeInTheDocument();
      expect(screen.getByText('hi from partner')).toBeInTheDocument();
      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('my reply')).toBeInTheDocument();
    });
  });

  test('partner_disconnected shows status text; chat_skipped resets to Idle with status', async () => {
    render(<RandomChatPage />);

    socket.__trigger('pair_found', { roomId: 'r3', partner: 'Ava' });

    socket.__trigger('partner_disconnected', 'They left.');
    await waitFor(() => {
      expect(screen.getByText(/They left\./i)).toBeInTheDocument();
    });

    socket.__trigger('chat_skipped', 'Stopped.');
    await waitFor(() => {
      expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
      expect(screen.getByText(/Stopped\./i)).toBeInTheDocument();
    });
  });

  test('Cancel button (and ESC) call skip_random_chat and reset UI', () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Find me a match/i));
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching/i);

    fireEvent.click(screen.getByText(/^Cancel$/i));
    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith('skip_random_chat');
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
    expect(screen.getByText(/Cancelled\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Find me a match/i));
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching/i);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith('skip_random_chat');
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
    expect(screen.getByText(/Cancelled\./i)).toBeInTheDocument();
  });

  test('AI flow + receive_message uses partner label "Foria"', async () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Chat with Foria/i));
    socket.__trigger('pair_found', { roomId: 'r-bot', partner: 'whatever' });

    await waitFor(() => {
      expect(screen.getByText(/You’re chatting with Foria/i)).toBeInTheDocument();
    });

    socket.__trigger('receive_message', { senderId: 999, content: 'I am an AI.' });
    await waitFor(() => {
      expect(screen.getByText('Foria')).toBeInTheDocument();
      expect(screen.getByText('I am an AI.')).toBeInTheDocument();
    });
  });
});
