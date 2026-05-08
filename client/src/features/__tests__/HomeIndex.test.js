/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

// ---- axiosClient stub ----
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

// ---- analytics stub ----
jest.mock('@/utils/analytics', () => ({
  __esModule: true,
  default: {
    capture: jest.fn(),
  },
}));

// ---- i18n stub ----
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

// ---- ThreadShell stub ----
jest.mock('@/threads/ThreadShell', () => ({
  __esModule: true,
  default: ({ header, composer, children }) => (
    <div data-testid="thread-shell">
      <div data-testid="thread-header">{header}</div>
      <div data-testid="thread-body">{children}</div>
      <div data-testid="thread-composer">{composer}</div>
    </div>
  ),
}));

// ---- ThreadComposer stub ----
jest.mock('@/threads/ThreadComposer.jsx', () => ({
  __esModule: true,
  default: ({ value, onChange, onSend, placeholder }) => (
    <div>
      <textarea
        aria-label="Message composer"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <button type="button" onClick={onSend}>
        Send message
      </button>
    </div>
  ),
}));

// ---- Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const cleanDomProps = (props) => {
    const {
      withBorder,
      radius,
      p,
      py,
      px,
      w,
      mt,
      mb,
      gap,
      wrap,
      align,
      justify,
      variant,
      size,
      fw,
      c,
      order,
      styles,
      withArrow,
      children,
      ...rest
    } = props;

    return { children, rest };
  };

  const Box = React.forwardRef((props, ref) => {
    const { children, rest } = cleanDomProps(props);
    return (
      <div ref={ref} {...rest}>
        {children}
      </div>
    );
  });

  const Group = (props) => {
    const { children, rest } = cleanDomProps(props);
    return <div {...rest}>{children}</div>;
  };

  const Paper = (props) => {
    const { children, rest } = cleanDomProps(props);
    return <div {...rest}>{children}</div>;
  };

  const Badge = (props) => {
    const { children, rest } = cleanDomProps(props);
    return <span {...rest}>{children}</span>;
  };

  const Text = (props) => {
    const { children, rest } = cleanDomProps(props);
    return <span {...rest}>{children}</span>;
  };

  const Title = ({ children, order = 2, ...props }) => {
    const Tag = `h${order}`;
    const { rest } = cleanDomProps(props);
    return <Tag {...rest}>{children}</Tag>;
  };

  const TextInput = React.forwardRef(
    ({ value, onChange, placeholder, styles, variant, ...props }, ref) => (
      <input
        ref={ref}
        aria-label="Recipient"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        {...props}
      />
    )
  );

  const ActionIcon = ({
    children,
    onClick,
    'aria-label': ariaLabel,
    variant,
    size,
    ...props
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );

  const Tooltip = ({ children }) => <>{children}</>;

  return {
    __esModule: true,
    Box,
    Group,
    Text,
    Title,
    TextInput,
    ActionIcon,
    Badge,
    Paper,
    Tooltip,
  };
});

// ---- Icon stubs ----
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconX: () => <span>x</span>,
}));

import HomeIndex from '../../features/chat/HomeIndex';

describe('HomeIndex', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.alert = jest.fn();
  });

  test('renders headline, subtext, recipient input, composer, and send button', () => {
    render(
      <MemoryRouter>
        <HomeIndex />
      </MemoryRouter>
    );

    expect(screen.getByText(/your messages/i)).toBeInTheDocument();

    expect(
      screen.getByText(
        /enter a recipient above, then send a message to start a conversation\./i
      )
    ).toBeInTheDocument();

    expect(screen.getByLabelText(/^recipient$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/message composer/i)).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /send message/i })
    ).toBeInTheDocument();
  });

  test('does not send when recipient is missing', () => {
    render(
      <MemoryRouter>
        <HomeIndex />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/message composer/i), {
      target: { value: 'hello world' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('sends SMS when recipient is a phone number', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        threadId: 'sms-thread-1',
      },
    });

    render(
      <MemoryRouter>
        <HomeIndex />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/^recipient$/i), {
      target: { value: '5551234567' },
    });

    fireEvent.change(screen.getByLabelText(/message composer/i), {
      target: { value: 'hello world' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/sms/send', {
        to: '+15551234567',
        body: 'hello world',
      });
    });
  });

  test('shows one-recipient alert when multiple recipients are entered', () => {
    render(
      <MemoryRouter>
        <HomeIndex />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/^recipient$/i), {
      target: { value: '5551234567, 5557654321' },
    });

    fireEvent.change(screen.getByLabelText(/message composer/i), {
      target: { value: 'hello world' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    expect(window.alert).toHaveBeenCalledWith(
      'Please enter one recipient for now.'
    );

    expect(mockPost).not.toHaveBeenCalled();
  });
});