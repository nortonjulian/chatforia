import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mocks ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const pass = (_Comp, testid) => ({ children, ...props }) =>
    React.createElement(
      'div',
      {
        'data-testid': testid,
        ...Object.fromEntries(
          Object.entries(props)
            .filter(([k]) => !['leftSection', 'rightSection', 'styles'].includes(k))
            .map(([k, v]) => [
              `data-${k}`,
              typeof v === 'object' ? JSON.stringify(v) : String(v),
            ])
        ),
      },
      children
    );

  const Button = ({
    children,
    onClick,
    loading,
    disabled,
    leftSection,
    rightSection,
    styles,
    component,
    href,
    target,
    ...rest
  }) => {
    const Comp = component === 'a' ? 'a' : 'button';

    return (
      <Comp
        data-testid="button"
        onClick={onClick}
        disabled={Comp === 'button' ? !!loading || !!disabled : undefined}
        href={href}
        target={target}
        {...rest}
      >
        {leftSection}
        {children}
        {rightSection}
      </Comp>
    );
  };

  const TextInput = ({
    value,
    onChange,
    onKeyDown,
    placeholder,
    'aria-label': ariaLabel,
    leftSection,
    style,
    ...rest
  }) => (
    <input
      data-testid="text-input"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      {...rest}
    />
  );

  const Textarea = ({ value, onChange, placeholder, minRows }) => (
    <textarea
      data-testid="textarea"
      placeholder={placeholder}
      rows={minRows}
      value={value}
      onChange={onChange}
    />
  );

  const Drawer = ({ opened, children, title, onClose }) => (
    <div data-testid="drawer" data-opened={String(!!opened)}>
      <div data-testid="drawer-title">{title}</div>
      <button data-testid="drawer-close" onClick={onClose}>
        X
      </button>
      {opened ? children : null}
    </div>
  );

  const SegmentedControl = ({ value, onChange, data }) => (
    <div data-testid="segmented" data-value={value}>
      {Array.isArray(data) &&
        data.map((d, i) => (
          <button
            key={i}
            data-testid={`seg-${d.value || d}`}
            onClick={() => onChange(d.value || d)}
          >
            {d.label || d}
          </button>
        ))}
    </div>
  );

  const ScrollArea = ({ children }) => <div data-testid="scrollarea">{children}</div>;
  ScrollArea.Autosize = ({ children }) => (
    <div data-testid="scrollarea-autosize">{children}</div>
  );

  const Divider = ({ label }) => <div data-testid="divider">{label}</div>;
  const Title = ({ children }) => <h1 data-testid="title">{children}</h1>;
  const Text = ({ children }) => <span data-testid="text">{children}</span>;
  const Badge = ({ children }) => <span data-testid="badge">{children}</span>;
  const Transition = ({ children }) =>
    typeof children === 'function' ? children({}) : children;
  const Affix = ({ children }) => <div data-testid="affix">{children}</div>;

  return {
    __esModule: true,
    Affix,
    Transition,
    Button,
    Drawer,
    TextInput,
    Textarea,
    Group: pass('div', 'group'),
    Stack: pass('div', 'stack'),
    SegmentedControl,
    Title,
    Text,
    Badge,
    ScrollArea,
    Divider,
    SimpleGrid: pass('div', 'simplegrid'),
    Card: pass('div', 'card'),
    Skeleton: pass('div', 'skeleton'),
  };
});

jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconMessageCircle: () => <i data-testid="icon-msg" />,
  IconSearch: () => <i data-testid="icon-search" />,
}));

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
  },
}));

jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: {
      id: 42,
      email: 'user@example.com',
      username: 'julian',
    },
  }),
}));

jest.mock('@/utils/analytics', () => ({
  __esModule: true,
  default: {
    capture: jest.fn(),
  },
}));

import SupportWidget from '../SupportWidget';

const setPath = (path) => {
  window.history.pushState({}, '', path);
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  setPath('/inbox');
});

describe('SupportWidget', () => {
  test('hides on excluded routes', () => {
    setPath('/settings/security');

    render(<SupportWidget excludeRoutes={['/settings']} />);

    expect(screen.queryByRole('button', { name: /open support/i })).toBeNull();
    expect(screen.queryByText(/help/i)).toBeNull();
  });

  test('shows FAB and opens drawer on click', () => {
    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    expect(screen.getByTestId('drawer')).toHaveAttribute('data-opened', 'true');
    expect(screen.getByTestId('badge')).toHaveTextContent(/support/i);
    expect(screen.getByTestId('title')).toHaveTextContent(/how can we help\?/i);
  });

  test('searches help via button click and shows results', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          title: 'Translate messages',
          snippet: 'How to auto-translate',
          url: 'https://help/article',
        },
      ],
    });

    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    fireEvent.change(screen.getByLabelText(/search help/i), {
      target: { value: 'translate' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/help/search', {
        params: { q: 'translate' },
      });
    });

    expect(screen.getByText(/translate messages/i)).toBeInTheDocument();
    expect(screen.getByText(/open article/i)).toBeInTheDocument();
  });

  test('searches help via Enter key', async () => {
    mockGet.mockResolvedValueOnce({ data: { results: [] } });

    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    const input = screen.getByLabelText(/search help/i);

    fireEvent.change(input, { target: { value: 'privacy' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/help/search', {
        params: { q: 'privacy' },
      });
    });
  });

  test('quick topic button switches to contact tab', () => {
    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    fireEvent.click(screen.getByText(/payments \/ billing/i));

    expect(screen.getByTestId('textarea')).toBeInTheDocument();
    expect(screen.getByText(/^send$/i)).toBeInTheDocument();
  });

  test('send button disabled when message is empty or whitespace', () => {
    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    fireEvent.click(screen.getByText(/report abuse/i));

    const send = screen.getByText(/^send$/i).closest('button');
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByTestId('textarea'), {
      target: { value: '   ' },
    });

    expect(send).toBeDisabled();
  });

  test('diagnoses then escalates ticket successfully', async () => {
    mockPost
      .mockResolvedValueOnce({
        data: {
          resolved: false,
          category: 'billing_or_premium',
          severity: 'normal',
          message: 'We need to escalate this.',
        },
      })
      .mockResolvedValueOnce({ data: { ok: true } });

    setPath('/chat/abc');

    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'JestAgent/1.0',
      configurable: true,
    });

    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    fireEvent.click(screen.getByText(/payments \/ billing/i));

    fireEvent.change(screen.getByTestId('textarea'), {
      target: { value: 'My card was charged twice.' },
    });

    const send = screen.getByText(/^send$/i).closest('button');
    expect(send).not.toBeDisabled();

    fireEvent.click(send);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    expect(mockPost.mock.calls[0][0]).toBe('/support/diagnose');
    expect(mockPost.mock.calls[0][1]).toEqual({
      email: 'user@example.com',
      message: 'My card was charged twice.',
      categoryHint: 'billing_or_premium',
    });

    expect(mockPost.mock.calls[1][0]).toBe('/support/tickets');
    expect(mockPost.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        name: 'julian',
        email: 'user@example.com',
        message: 'My card was charged twice.',
        categoryHint: 'billing_or_premium',
        meta: expect.objectContaining({
          userId: 42,
          path: '/chat/abc',
          userAgent: 'JestAgent/1.0',
          app: 'web',
          version: expect.any(String),
        }),
      })
    );

    expect(
      await screen.findByText(/we couldn’t resolve this automatically\. our team will follow up\./i)
    ).toBeInTheDocument();
  });

  test('resolved diagnosis stops before creating ticket', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        resolved: true,
        category: 'auth_or_verification',
        severity: 'low',
        message: 'Try resetting your password.',
        nextAction: 'Use the password reset email.',
      },
    });

    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    fireEvent.click(screen.getByText(/can’t log in/i));

    fireEvent.change(screen.getByTestId('textarea'), {
      target: { value: 'Cannot log in.' },
    });

    fireEvent.click(screen.getByText(/^send$/i));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    expect(mockPost.mock.calls[0][0]).toBe('/support/diagnose');
    expect(screen.getByText(/try resetting your password/i)).toBeInTheDocument();
    expect(screen.getByText(/issue resolved instantly/i)).toBeInTheDocument();
  });

  test('shows error when diagnose or ticket submission fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('boom'));

    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    fireEvent.click(screen.getByText(/can’t log in/i));

    fireEvent.change(screen.getByTestId('textarea'), {
      target: { value: 'Cannot log in.' },
    });

    fireEvent.click(screen.getByText(/^send$/i));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
    });

    expect(
      screen.getByText(/something went wrong\. please try again\./i)
    ).toBeInTheDocument();
  });

  test('recommended action posts to support actions and shows action message', async () => {
    mockPost
      .mockResolvedValueOnce({
        data: {
          resolved: true,
          category: 'auth_or_verification',
          severity: 'low',
          message: 'We can help automatically.',
          autoAction: 'resend_verification_email',
        },
      })
      .mockResolvedValueOnce({
        data: {
          message: 'Verification email sent.',
        },
      });

    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    fireEvent.click(screen.getByText(/can’t log in/i));

    fireEvent.change(screen.getByTestId('textarea'), {
      target: { value: 'Need verification email.' },
    });

    fireEvent.click(screen.getByText(/^send$/i));

    expect(
      await screen.findByText(/take recommended action/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText(/take recommended action/i));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/support/actions', {
        action: 'resend_verification_email',
        email: 'user@example.com',
      });
    });

    expect(screen.getByText(/verification email sent/i)).toBeInTheDocument();
  });

  test('clears state when drawer closes and reopens', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        results: [{ title: 'A', snippet: 'B' }],
      },
    });

    render(<SupportWidget />);

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    fireEvent.change(screen.getByLabelText(/search help/i), {
      target: { value: 'backups' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });

    expect(screen.getByText('A')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('drawer-close'));

    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    expect(
      screen.getByText(/try searching for “translate”, “backups”, or “privacy”\./i)
    ).toBeInTheDocument();

    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });
});