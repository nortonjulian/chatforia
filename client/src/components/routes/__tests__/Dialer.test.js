import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockSocketListeners = {};
jest.mock('@/context/SocketContext', () => ({ useSocketRaw: () => ({
  on: (name, callback) => { (mockSocketListeners[name] ||= new Set()).add(callback); },
  off: (name, callback) => mockSocketListeners[name]?.delete(callback),
}) }));
jest.mock('@/api/calls', () => {
  const getCallHistory = jest.fn().mockResolvedValue([]);
  return { __esModule: true, getCallHistory,
    getCallHistoryPage: options => getCallHistory(options).then(items => ({ items, nextCursor: null })),
    deleteCallHistory: jest.fn().mockResolvedValue({ ok: true, count: 2 }),
  };
});

jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: { id: 1 },
  }),
}));

const mockStartCall = jest.fn();

jest.mock('@/context/CallContext', () => ({
  __esModule: true,
  useCall: () => ({
    startCall: mockStartCall,
    pending: false,
  }),
}));

const mockPlaceCall = jest.fn();

jest.mock('@/hooks/usePstnCall', () => ({
  __esModule: true,
  usePstnCall: () => ({
    placeCall: mockPlaceCall,
    loading: false,
    error: '',
  }),
}));

const mockStartBrowserCall = jest.fn();

jest.mock('@/hooks/useTwilioVoice', () => ({
  __esModule: true,
  useTwilioVoice: () => ({
    startBrowserCall: mockStartBrowserCall,
    ready: true,
    calling: false,
    error: '',
  }),
}));

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useSearchParams: () => [new URLSearchParams()],
}));

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback || _key,
  }),
}));

jest.mock('lucide-react', () => {
  const Icon = () => <span data-testid="icon" />;

  return {
    __esModule: true,
    PhoneOutgoing: Icon,
    PhoneIncoming: Icon,
    PhoneMissed: Icon,
    Voicemail: Icon,
    Phone: Icon,
    Trash2: Icon,
    Video: Icon,
  };
});

jest.mock('@mantine/core', () => {
  const React = require('react');

  const cleanProps = (props = {}) => {
    const {
      p,
      py,
      px,
      m,
      my,
      mx,
      mt,
      mb,
      ml,
      mr,
      fw,
      c,
      size,
      gap,
      justify,
      align,
      wrap,
      radius,
      variant,
      color,
      withBorder,
      loading,
      leftSection,
      ...rest
    } = props;

    return rest;
  };

  const Box = ({ children, ...props }) => (
    <div data-testid="box" {...cleanProps(props)}>
      {children}
    </div>
  );

  const Group = ({ children, ...props }) => (
    <div data-testid="group" {...cleanProps(props)}>
      {children}
    </div>
  );

  const Stack = ({ children, ...props }) => (
    <div data-testid="stack" {...cleanProps(props)}>
      {children}
    </div>
  );

  const Text = ({ children, ...props }) => (
    <div data-testid="text" {...cleanProps(props)}>
      {children}
    </div>
  );

  const Button = ({ children, onClick, disabled, loading, ...props }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!!disabled || !!loading}
      aria-busy={loading ? 'true' : 'false'}
      {...cleanProps(props)}
    >
      {children}
    </button>
  );

  const TextInput = ({ value, onChange, placeholder, disabled, ...props }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      {...cleanProps(props)}
    />
  );

  const Divider = () => <hr />;

  const Loader = () => <div data-testid="loader" />;

  const Card = ({ children, ...props }) => (
    <div data-testid="card" {...cleanProps(props)}>
      {children}
    </div>
  );

  const ThemeIcon = ({ children, ...props }) => (
    <span data-testid="theme-icon" {...cleanProps(props)}>
      {children}
    </span>
  );

  const Badge = ({ children, ...props }) => (
    <span data-testid="badge" {...cleanProps(props)}>
      {children}
    </span>
  );

  const ActionIcon = ({ children, onClick, disabled, ...props }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...cleanProps(props)}
    >
      {children}
    </button>
  );

  const Modal = ({
    opened,
    title,
    children,
  }) => {
    if (!opened) return null;

    return (
      <div
        role="dialog"
        aria-label={title}
      >
        <h2>{title}</h2>
        {children}
      </div>
    );
  };

  return {
    __esModule: true,
    Box,
    Group,
    Button,
    TextInput,
    Stack,
    Text,
    Divider,
    Loader,
    Card,
    ThemeIcon,
    Badge,
    ActionIcon,
    Modal,
  };
});

import axiosClient from '@/api/axiosClient';
import { getCallHistory, deleteCallHistory } from '@/api/calls';
import Dialer from '../Dialer';

describe('Dialer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCallHistory.mockReset().mockResolvedValue([]);
    deleteCallHistory.mockReset().mockResolvedValue({ ok: true, count: 2 });
  });

  it('renders header, helper text, input, keypad, and actions', async () => {
    render(<Dialer />);

    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(
      screen.getByText(/Make phone calls and review your recent calls\./i)
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter number')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Call' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '*' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '⌫' })).toBeInTheDocument();

    await waitFor(() => {
      expect(getCallHistory).toHaveBeenCalledTimes(1);
    });
  });

  it('builds digits when keypad buttons are pressed', async () => {
    const user = userEvent.setup();

    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '3' }));

    expect(input).toHaveValue('123');
  });

  it('supports manual typing into the input', async () => {
    const user = userEvent.setup();

    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');

    await user.type(input, '555');

    expect(input).toHaveValue('555');
  });

  it('backspace removes the last digit', async () => {
    const user = userEvent.setup();

    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');

    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: '6' }));

    expect(input).toHaveValue('456');

    await user.click(screen.getByRole('button', { name: '⌫' }));

    expect(input).toHaveValue('45');
  });

  it('enforces max length of 32 digits when pressing keypad', async () => {
    const user = userEvent.setup();

    render(<Dialer />);

    const input = screen.getByPlaceholderText('Enter number');
    const zeroBtn = screen.getByRole('button', { name: '0' });

    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await user.click(zeroBtn);
    }

    expect(input.value.length).toBe(32);
    expect(input).toHaveValue('0'.repeat(32));
  });

  it('call button places a PSTN call when number exists', async () => {
    const user = userEvent.setup();

    render(<Dialer />);

    await user.type(screen.getByPlaceholderText('Enter number'), '5551234567');
    await user.click(screen.getByRole('button', { name: 'Call' }));

    expect(mockPlaceCall).toHaveBeenCalledWith('5551234567');
  });

  it('cancels recent-call deletion from the styled modal', async () => {
    const user = userEvent.setup();

    getCallHistory.mockResolvedValueOnce([
      {
        id: 42,
        callerId: 1,
        callee: {
          id: 2,
          username: 'Bob',
        },
        mode: 'AUDIO',
        status: 'ENDED',
        createdAt: '2026-08-14T00:00:00.000Z',
      },
    ]);

    render(<Dialer />);

    await user.click(
      await screen.findByRole(
        'button',
        {
          name: 'Delete call with Bob',
        }
      )
    );

    expect(
      screen.getByRole(
        'dialog',
        {
          name: 'Delete recent call?',
        }
      )
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole(
        'button',
        {
          name: 'Cancel',
        }
      )
    );

    expect(
      axiosClient.delete
    ).not.toHaveBeenCalled();

    expect(
      screen.queryByRole(
        'dialog',
        {
          name: 'Delete recent call?',
        }
      )
    ).not.toBeInTheDocument();
  });

  it('deletes a recent call after styled confirmation', async () => {
    const user = userEvent.setup();

    getCallHistory.mockResolvedValueOnce([
      {
        id: 42,
        callerId: 1,
        callee: {
          id: 2,
          username: 'Bob',
        },
        mode: 'AUDIO',
        status: 'ENDED',
        createdAt: '2026-08-14T00:00:00.000Z',
      },
    ]);

    axiosClient.delete.mockResolvedValueOnce({
      data: {
        ok: true,
      },
    });

    render(<Dialer />);

    await user.click(
      await screen.findByRole(
        'button',
        {
          name: 'Delete call with Bob',
        }
      )
    );

    await user.click(
      screen.getByRole(
        'button',
        {
          name: 'Delete',
        }
      )
    );

    await waitFor(() => {
      expect(
        axiosClient.delete
      ).toHaveBeenCalledWith(
        '/calls/42'
      );
    });

    expect(
      screen.queryByText('Bob')
    ).not.toBeInTheDocument();
  });
  const row = (id, username) => ({ id, callerId: 1, callee: { id: 2, username },
    mode: 'VIDEO', status: 'ENDED', createdAt: `2026-10-19T10:${String(id).padStart(2, '0')}:00Z` });

  it('selects multiple calls by ID, confirms and removes only those rows', async () => {
    const user = userEvent.setup(); getCallHistory.mockResolvedValue([row(42, 'Bob'), row(43, 'Regina'), row(44, 'Papi')]);
    render(<Dialer />); await screen.findByText('Bob');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('checkbox', { name: /Select call with Bob/ }));
    await user.click(screen.getByRole('checkbox', { name: /Select call with Regina/ }));
    await user.click(screen.getByRole('button', { name: 'Delete selected (2)' }));
    expect(deleteCallHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Delete selected calls?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteCallHistory).toHaveBeenCalledWith([43, 42]));
    expect(screen.queryByText('Bob')).toBeNull(); expect(screen.queryByText('Regina')).toBeNull();
    expect(screen.getByText('Papi')).toBeInTheDocument();
  });

  it('cancel preserves selection; Done exits without a deletion', async () => {
    const user = userEvent.setup(); getCallHistory.mockResolvedValue([row(42, 'Bob'), row(43, 'Regina')]);
    render(<Dialer />); await screen.findByText('Bob');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Select all shown' }));
    await user.click(screen.getByRole('button', { name: 'Delete selected (2)' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('checkbox').every(box => box.checked)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(deleteCallHistory).not.toHaveBeenCalled();
  });

  it('failed bulk deletion leaves rows and selection available for retry', async () => {
    const user = userEvent.setup(); getCallHistory.mockResolvedValue([row(42, 'Bob'), row(43, 'Regina')]);
    deleteCallHistory.mockRejectedValueOnce(new Error('Network unavailable'));
    render(<Dialer />); await screen.findByText('Bob');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Select all shown' }));
    await user.click(screen.getByRole('button', { name: 'Delete selected (2)' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByText('Bob')).toBeInTheDocument(); expect(screen.getAllByRole('checkbox').every(box => box.checked)).toBe(true);
  });

  it('socket events refetch and preserve selected identities without selecting new calls', async () => {
    const user = userEvent.setup(); getCallHistory.mockResolvedValue([row(42, 'Bob')]);
    render(<Dialer />); await screen.findByText('Bob');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('checkbox', { name: /Select call with Bob/ }));
    getCallHistory.mockResolvedValue([row(43, 'Regina'), row(42, 'Bob')]);
    act(() => { mockSocketListeners['call:history-changed'].forEach(fn => fn()); });
    await screen.findByText('Regina');
    expect(screen.getByRole('checkbox', { name: /Select call with Bob/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Select call with Regina/ })).not.toBeChecked();
  });

});
