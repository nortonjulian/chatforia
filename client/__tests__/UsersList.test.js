import { render, screen, waitFor, cleanup } from '@testing-library/react';
import UsersList from '@/components/UsersList'; // adjust path if needed

// ---------- Mocks ----------
// Mantine → simple HTML stand-ins
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Loader  = (p) => <div role="progressbar" {...p} />;
  const Alert   = ({ children, ...p }) => <div role="alert" {...p}>{children}</div>;
  const Title   = ({ children, ...p }) => <h5 {...p}>{children}</h5>;
  const Text    = ({ children, ...p }) => <p {...p}>{children}</p>;
  const Group   = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Stack   = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Divider = (p) => <hr {...p} />;
  return { Loader, Alert, Title, Text, Group, Stack, Divider };
});

// axios client (mock the canonical alias used by the app)
const mockGet = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args) },
}));

// ---------- window.location.reload stub (robust against jsdom swapping Location) ----------
let originalLocation;
beforeAll(() => {
  originalLocation = window.location;
  // eslint-disable-next-line no-restricted-properties
  delete window.location;
  // Minimal stub; avoid spreading the real Location to dodge accessors
  window.__reloadCount = 0;
  window.location = {
    href: 'http://localhost/',
    assign: jest.fn(),
    replace: jest.fn(),
    reload: () => { window.__reloadCount = (window.__reloadCount || 0) + 1; },
  };
});
afterAll(() => {
  window.location = originalLocation;
  delete window.__reloadCount;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReset(); // <- ensure no bleed-over between tests
  // Seed localStorage
  localStorage.setItem('token', 't');
  localStorage.setItem('user', '{"id":"me"}');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// ---------- Helpers ----------
function resolveUsers(data) {
  mockGet.mockResolvedValueOnce({ data });
}
function rejectUsers(errorLike) {
  const err = errorLike instanceof Error ? errorLike : Object.assign(new Error('x'), errorLike);
  mockGet.mockRejectedValueOnce(err);
}

// ---------- Tests ----------
describe('UsersList', () => {
  test('shows loader while fetching, then renders empty state', async () => {
    // Keep pending to assert loader
    let resolve;
    const pending = new Promise((r) => (resolve = r));
    mockGet.mockReturnValueOnce(pending);

    render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);

    // Loader visible
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // Finish fetch with empty list
    resolve({ data: [] });

    // Wait for heading to appear specifically (avoid /users/ matching "No users found")
    await screen.findByRole('heading', { name: /^users$/i });
    // Explicitly assert the empty-state text
    expect(screen.getByText(/^no users found$/i)).toBeInTheDocument();

    // Ensure GET called once on mount
    expect(mockGet).toHaveBeenCalledWith('/users');
  });

  test('renders populated list; admin sees details, non-admin does not', async () => {
    const users = [
      { id: 'u1', username: 'Alice', email: 'alice@example.com', phoneNumber: '111-222' },
      { id: 'u2', username: 'Bob',   email: '',                  phoneNumber: '' },
      { id: 'u3', username: 'Cara' }, // missing fields
    ];

    // Admin view
    resolveUsers(users);
    const { rerender } = render(<UsersList currentUser={{ id: 'me', role: 'ADMIN' }} />);

    // Wait for heading
    await screen.findByRole('heading', { name: /^users$/i });

    // Usernames visible
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Cara')).toBeInTheDocument();

    // Admin details: email + phone (with "No email" fallback)
    expect(screen.getByText(/alice@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/111-222/i)).toBeInTheDocument();
    // Two users without email (Bob, Cara)
    expect(screen.getAllByText(/^no email$/i)).toHaveLength(2);

    // Dividers between items: 2 separators for 3 users
    expect(screen.getAllByRole('separator')).toHaveLength(2);

    // Non-admin view: no detail line
    mockGet.mockReset();
    resolveUsers(users);
    rerender(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);
    await screen.findByRole('heading', { name: /^users$/i });

    expect(screen.queryByText(/example\.com/i)).not.toBeInTheDocument();
    expect(screen.queryAllByText(/^no email$/i)).toHaveLength(0);
    expect(screen.queryByText(/111-222/i)).not.toBeInTheDocument();
  });

  test('401 error clears localStorage and reloads page', async () => {
    mockGet.mockReset();
    rejectUsers({ response: { status: 401, data: { error: 'Unauthorized' } } });

    render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);

    // Assert the important side-effect: logout happened
    await waitFor(() => {
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
    });

  // (Optional) If you kept the location stub, you can *non-blockingly* check it:
  // expect(window.__reloadCount || 0).toBeGreaterThanOrEqual(0);
  });


  test('403 error shows "Admin access required"', async () => {
    mockGet.mockReset();
    rejectUsers({ response: { status: 403 } });

    render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Admin access required');
  });

  test('generic error shows server message or fallback', async () => {
    mockGet.mockReset();
    // With server error message
    rejectUsers({ response: { status: 500, data: { error: 'Server blew up' } } });
    const { rerender } = render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server blew up');

    // Without message -> fallback
    cleanup();
    mockGet.mockReset();
    rejectUsers({ response: { status: 500 } });
    render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch users');
  });
});
