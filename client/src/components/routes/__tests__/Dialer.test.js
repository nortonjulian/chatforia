import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/api/calls', () => ({
  __esModule: true,
  getCallHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: { id: 1 },
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
  };
});

import { getCallHistory } from '@/api/calls';
import Dialer from '../Dialer';

describe('Dialer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCallHistory.mockResolvedValue([]);
  });

  it('renders header, helper text, input, keypad, and actions', async () => {
    render(<Dialer />);

    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(screen.getByText(/Keypad & recents\./i)).toBeInTheDocument();
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
});