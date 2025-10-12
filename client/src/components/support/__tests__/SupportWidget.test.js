import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mocks ----

// Mock Mantine components so we can inspect props & interact predictably
jest.mock('@mantine/core', () => {
  const React = require('react');
  const pass = (Comp, testid) => ({ children, ...props }) =>
    React.createElement(
      'div',
      { 'data-testid': testid, ...Object.fromEntries(Object.entries(props).map(([k, v]) => [`data-${k}`, typeof v === 'object' ? JSON.stringify(v) : String(v)])) },
      children
    );

  const Button = ({ children, onClick, loading, disabled, ...rest }) => (
    <button data-testid="button" onClick={onClick} disabled={!!loading || !!disabled} {...rest}>
      {children}
    </button>
  );

  const TextInput = ({ value, onChange, onKeyDown, placeholder, 'aria-label': ariaLabel }) => (
    <input
      data-testid="text-input"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
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
      <button data-testid="drawer-close" onClick={onClose}>X</button>
      {children}
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
  ScrollArea.Autosize = ({ children }) => <div data-testid="scrollarea-autosize">{children}</div>;

  const Divider = ({ label }) => <div data-testid="divider">{label}</div>;
  const Title = ({ children }) => <h1 data-testid="title">{children}</h1>;
  const Text = ({ children }) => <span data-testid="text">{children}</span>;
  const Badge = ({ children }) => <span data-testid="badge">{children}</span>;
  const Transition = ({ children }) => (typeof children === 'function' ? children({}) : children);
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

// Mock icons (not relevant to behavior)
jest.mock('@tabler/icons-react', () => ({
  __esModule: true,
  IconMessageCircle: () => <i data-testid="icon-msg" />,
  IconSearch: () => <i data-testid="icon-search" />,
}));

// Mock axios client
const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...a) => getMock(...a), post: (...a) => postMock(...a) },
}));

// Mock user context
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ currentUser: { id: 42, email: 'user@example.com' } }),
}));

// SUT
import SupportWidget from './SupportWidget';

// Helpers
const setPath = (path) => {
  window.history.pushState({}, '', path);
};

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  setPath('/inbox');
});

describe('SupportWidget', () => {
  test('hides on excluded routes', () => {
    setPath('/settings/security');
    render(<SupportWidget excludeRoutes={['/settings']} />);
    // FAB shouldn't render at all
    expect(screen.queryByRole('button', { name: /open support/i })).toBeNull();
    expect(screen.queryByText(/help/i)).toBeNull();
  });

  test('shows FAB, opens drawer on click', () => {
    render(<SupportWidget />);
    const fab = screen.getByRole('button', { name: /open support/i });
    fireEvent.click(fab);
    const drawer = screen.getByTestId('drawer');
    expect(drawer).toHaveAttribute('data-opened', 'true');
    // Title content should be present
    expect(screen.getByTestId('badge')).toHaveTextContent(/support/i);
    expect(screen.getByTestId('title')).toHaveTextContent(/how can we help\?/i);
  });

  test('searches help via button click and shows results', async () => {
    getMock.mockResolvedValueOnce({
      data: [{ title: 'Translate messages', snippet: 'How to auto-translate', url: 'https://help/article' }],
    });

    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    const input = screen.getByLabelText(/search help/i);
    fireEvent.change(input, { target: { value: 'translate' } });
    fireEvent.click(screen.getByText(/search/i));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/help/search', { params: { q: 'translate' } });
    });

    // Result card
    expect(screen.getByText(/translate messages/i)).toBeInTheDocument();
    expect(screen.getByText(/open article/i)).toBeInTheDocument();
  });

  test('searches help via Enter key', async () => {
    getMock.mockResolvedValueOnce({ data: { results: [] } });

    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    const input = screen.getByLabelText(/search help/i);
    fireEvent.change(input, { target: { value: 'privacy' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/help/search', { params: { q: 'privacy' } });
    });
  });

  test('quick topic button switches to contact tab', () => {
    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    // Click quick topic "Payments / billing"
    fireEvent.click(screen.getByText(/payments \/ billing/i));

    // Contact tab should show textarea + Send button
    expect(screen.getByTestId('textarea')).toBeInTheDocument();
    expect(screen.getByText(/^send$/i)).toBeInTheDocument();
  });

  test('send button disabled when message is empty or whitespace', () => {
    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    // Jump to contact by clicking a quick topic
    fireEvent.click(screen.getByText(/report abuse/i));

    const send = screen.getByText(/^send$/i).closest('button');
    expect(send).toBeDisabled();

    const ta = screen.getByTestId('textarea');
    fireEvent.change(ta, { target: { value: '   ' } });
    // Disabled because only whitespace
    expect(send).toBeDisabled();
  });

  test('submits ticket successfully and shows confirmation', async () => {
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    setPath('/chat/abc');
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'JestAgent/1.0',
      configurable: true,
    });

    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    // choose a topic to jump to contact
    fireEvent.click(screen.getByText(/payments \/ billing/i));

    const ta = screen.getByTestId('textarea');
    fireEvent.change(ta, { target: { value: 'My card was charged twice.' } });

    const send = screen.getByText(/^send$/i).closest('button');
    expect(send).not.toBeDisabled();
    fireEvent.click(send);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    // Validate payload shape & key meta fields
    const [url, payload] = postMock.mock.calls[0];
    expect(url).toBe('/support/tickets');
    expect(payload).toEqual(
      expect.objectContaining({
        topic: 'billing',
        message: 'My card was charged twice.',
        meta: expect.objectContaining({
          userId: 42,
          path: '/chat/abc',
          userAgent: 'JestAgent/1.0',
          app: 'web',
          // version may be "web" fallback or a string if env is set
          version: expect.any(String),
        }),
      })
    );

    // Success message shown
    await waitFor(() => {
      expect(screen.getByText(/message sent\. we’ll reply by email\./i)).toBeInTheDocument();
    });
  });

  test('shows error when submission fails', async () => {
    postMock.mockRejectedValueOnce(new Error('boom'));

    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    // jump to contact
    fireEvent.click(screen.getByText(/can’t log in/i));

    const ta = screen.getByTestId('textarea');
    fireEvent.change(ta, { target: { value: 'Cannot log in.' } });

    fireEvent.click(screen.getByText(/^send$/i));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });

    expect(
      screen.getByText(/could not send\. email support@chatforia\.com instead\./i)
    ).toBeInTheDocument();
  });

  test('clears state when drawer closes', async () => {
    getMock.mockResolvedValueOnce({ data: { results: [{ title: 'A', snippet: 'B' }] } });

    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));

    // Do a search
    const input = screen.getByLabelText(/search help/i);
    fireEvent.change(input, { target: { value: 'backups' } });
    fireEvent.click(screen.getByText(/search/i));
    await waitFor(() => expect(getMock).toHaveBeenCalled());

    // Close drawer
    fireEvent.click(screen.getByTestId('drawer-close'));

    // Re-open; state should be cleared and placeholder text shown (no results)
    fireEvent.click(screen.getByRole('button', { name: /open support/i }));
    expect(
      screen.getByText(/try searching for “translate”, “backups”, or “privacy”\./i)
    ).toBeInTheDocument();
  });
});
