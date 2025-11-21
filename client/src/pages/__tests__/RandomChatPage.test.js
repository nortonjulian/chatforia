import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';

/* ---------------- Mantine stub ---------------- */
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Paper = ({ children, withBorder, ...rest }) => (
    <div data-testid="paper" {...rest}>
      {children}
    </div>
  );

  const Group = ({ children, ...rest }) => (
    <div data-testid="group" {...rest}>
      {children}
    </div>
  );

  const Stack = ({ children, ...rest }) => (
    <div data-testid="stack" {...rest}>
      {children}
    </div>
  );

  const Text = ({ children, ...rest }) => (
    <div data-testid="text" {...rest}>
      {children}
    </div>
  );

  const Badge = ({ children, ...rest }) => (
    <span data-testid="badge" {...rest}>
      {children}
    </span>
  );

  // Use <h3> so it has role="heading"
  const Title = ({ children, ...rest }) => (
    <h3 data-testid="title" {...rest}>
      {children}
    </h3>
  );

  // Drop unknown props like leftSection so React doesn't warn
  const Button = ({ children, leftSection, ...rest }) => (
    <button type="button" {...rest}>
      {children}
    </button>
  );

  const Loader = (props) => (
    <span data-testid="loader" {...props}>
      Loading…
    </span>
  );

  const TextInput = ({ value, onChange, onKeyDown, ...rest }) => (
    <input
      data-testid="draft-input"
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      {...rest}
    />
  );

  const Card = ({ children, ...rest }) => (
    <div data-testid="card" {...rest}>
      {children}
    </div>
  );

  return {
    __esModule: true,
    Paper,
    Group,
    Stack,
    Text,
    Badge,
    Title,
    Button,
    Loader,
    TextInput,
    Card,
  };
});

/* ---------------- Icons stub ---------------- */
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconMessageCircle: () => <i data-testid="icon-msg" />,
  IconPlayerPlay: () => <i data-testid="icon-play" />,
  IconPlayerStop: () => <i data-testid="icon-stop" />,
  IconRobot: () => <i data-testid="icon-robot" />,
}));

/* ---------------- User context stub ---------------- */
/**
 * NOTE: We give the user an `ageBand` so the startSearch()
 * path actually emits `find_random_chat` instead of showing
 * the “set your age range” message.
 */
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: { id: 42, username: 'me', ageBand: '18-24' },
  }),
}));

/* ---------------- Router helpers ---------------- */
jest.mock('react-router-dom', () => {
  return {
    __esModule: true,
    useNavigate: () => jest.fn(),
  };
});

/* ---- Socket singleton mock (robust shared state) ---- */
globalThis.__socketState =
  globalThis.__socketState || { handlers: {}, emitMock: jest.fn() };
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

    expect(
      screen.getByRole('heading', { name: /Random Chat/i })
    ).toBeInTheDocument();

    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);

    expect(screen.getByText(/Find me a match/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancel/i)).toBeInTheDocument();
    expect(screen.getByText(/Chat with Ria/i)).toBeInTheDocument();
  });

  test('starting a search emits find_random_chat and shows Searching badge + status', () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Find me a match/i));

    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith('find_random_chat');
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching…/i);
    expect(
      screen.getByText(/Looking for someone…/i)
    ).toBeInTheDocument();
  });

  test('starting an AI chat emits start_ai_chat and normalizes next pair_found to "Ria" with BOT badge', async () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Chat with Ria/i));
    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith('start_ai_chat');
    expect(
      screen.getByText(/Starting a chat with Ria/i)
    ).toBeInTheDocument();

    await act(async () => {
      socket.__trigger('pair_found', { roomId: 'r1', partner: 'Somebody' });
    });

    await waitFor(() => {
      const badges = screen.getAllByTestId('badge');
      expect(
        badges.some((el) => /With Ria/i.test(el.textContent || ''))
      ).toBe(true);
    });

    expect(
      screen.getByText(/You’re chatting with/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/BOT/i)).toBeInTheDocument();
    expect(screen.getByText(/Say hi/i)).toBeInTheDocument();
  });

  test('pair_found (human) shows Connected badge and header text without BOT', async () => {
    render(<RandomChatPage />);
    fireEvent.click(screen.getByText(/Find me a match/i));

    await act(async () => {
      socket.__trigger('pair_found', { roomId: 'room-7', partner: 'Sam' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('badge')).toHaveTextContent(/Connected/i);
    });

    expect(
      screen.getByText(/You’re chatting with/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/BOT/i)).toBeNull();
  });

  test('sending messages: trims content, uses active.roomId, clears input, and disables button when blank', async () => {
    render(<RandomChatPage />);

    await act(async () => {
      socket.__trigger('pair_found', { roomId: 'xyz', partner: 'Alex' });
    });

    const input = await screen.findByTestId('draft-input');
    const sendBtn = await screen.findByText(/^Send$/i);

    expect(sendBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '   ' } });
    expect(sendBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '  hello there  ' } });
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);

    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({
        content: 'hello there',
        randomChatRoomId: 'xyz',
      })
    );

    await waitFor(() => {
      expect(input).toHaveValue('');
      expect(sendBtn).toBeDisabled();
    });
  });

  test('receive_message appends; label shows "You" for self and partner label for others', async () => {
    render(<RandomChatPage />);

    await act(async () => {
      socket.__trigger('pair_found', { roomId: 'r2', partner: 'Casey' });
      socket.__trigger('receive_message', {
        senderId: 999,
        content: 'hi from partner',
      });
      socket.__trigger('receive_message', {
        senderId: 42,
        content: 'my reply',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Casey')).toBeInTheDocument();
      expect(
        screen.getByText('hi from partner')
      ).toBeInTheDocument();
      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('my reply')).toBeInTheDocument();
    });
  });

  test('partner_disconnected shows status text; chat_skipped resets to Idle with status', async () => {
    render(<RandomChatPage />);

    await act(async () => {
      socket.__trigger('pair_found', { roomId: 'r3', partner: 'Ava' });
      socket.__trigger('partner_disconnected', 'They left.');
    });

    await waitFor(() => {
      expect(
        screen.getByText(/They left\./i)
      ).toBeInTheDocument();
    });

    await act(async () => {
      socket.__trigger('chat_skipped', 'Stopped.');
    });

    await waitFor(() => {
      expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
      expect(
        screen.getByText(/Stopped\./i)
      ).toBeInTheDocument();
    });
  });

  test('Cancel button (and ESC) call skip_random_chat and reset UI', () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Find me a match/i));
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching/i);

    fireEvent.click(screen.getByText(/^Cancel$/i));
    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith(
      'skip_random_chat'
    );
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
    expect(
      screen.getByText(/Cancelled\./i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Find me a match/i));
    expect(screen.getByTestId('badge')).toHaveTextContent(/Searching/i);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(globalThis.__serverEmitMock).toHaveBeenCalledWith(
      'skip_random_chat'
    );
    expect(screen.getByTestId('badge')).toHaveTextContent(/Idle/i);
    expect(
      screen.getByText(/Cancelled\./i)
    ).toBeInTheDocument();
  });

  test('AI flow + receive_message uses partner label "Ria"', async () => {
    render(<RandomChatPage />);

    fireEvent.click(screen.getByText(/Chat with Ria/i));

    await act(async () => {
      socket.__trigger('pair_found', {
        roomId: 'r-bot',
        partner: 'whatever',
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/You’re chatting with/i)
      ).toBeInTheDocument();
    });

    await act(async () => {
      socket.__trigger('receive_message', {
        senderId: 999,
        content: 'I am an AI.',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Ria')).toBeInTheDocument();
      expect(
        screen.getByText('I am an AI.')
      ).toBeInTheDocument();
    });
  });
});
