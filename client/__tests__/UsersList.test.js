import { render, screen, waitFor, cleanup } from '@testing-library/react';
import UsersList from '@/components/UsersList'; // adjust path if needed

// ---------- Mocks ----------
// Mantine → simple HTML stand-ins
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Loader = (p) => <div role="progressbar" {...p} />;
  const Alert = ({ children, ...p }) => <div role="alert" {...p}>{children}</div>;
  const Title = ({ children, ...p }) => <h5 {...p}>{children}</h5>;
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  const Group = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Stack = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Divider = (p) => <hr {...p} />;
  return { Loader, Alert, Title, Text, Group, Stack, Divider };
});

// axios client
const getMock = jest.fn();
jest.mock('@/components/../api/axiosClient', () => ({
  __esModule: true,
  default: { get: (...args) => getMock(...args) },
}));

// window.location.reload
const reloadSpy = jest.fn();
const originalLocation = window.location;

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: reloadSpy },
  });
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

beforeEach(() => {
  jest.clearAllMocks();
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
  getMock.mockResolvedValueOnce({ data });
}
function rejectUsers(errorLike) {
  const err = errorLike instanceof Error ? errorLike : Object.assign(new Error('x'), errorLike);
  getMock.mockRejectedValueOnce(err);
}

// ---------- Tests ----------
describe('UsersList', () => {
  test('shows loader while fetching, then renders empty state', async () => {
    // Keep pending to assert loader
    let resolve;
    const pending = new Promise((r) => (resolve = r));
    getMock.mockReturnValueOnce(pending);

    const { rerender } = render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);

    // Loader visible
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // Finish fetch with empty list
    resolve({ data: [] });
    // Wait for loader to disappear & content appear
    await waitFor(() => {
      expect(screen.getByText(/users/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/no users found/i)).toBeInTheDocument();

    // Ensure GET called once on mount
    expect(getMock).toHaveBeenCalledWith('/users');
  });

  test('renders populated list; admin sees details, non-admin does not', async () => {
    const users = [
      { id: 'u1', username: 'Alice', email: 'alice@example.com', phoneNumber: '111-222' },
      { id: 'u2', username: 'Bob', email: '', phoneNumber: '' },
      { id: 'u3', username: 'Cara' }, // missing fields
    ];

    // Admin view
    resolveUsers(users);
    const { rerender } = render(<UsersList currentUser={{ id: 'me', role: 'ADMIN' }} />);

    // Wait for list
    expect(await screen.findByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Cara')).toBeInTheDocument();

    // Admin details: email + phone (with "No email" fallback)
    expect(screen.getByText(/alice@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/111-222/i)).toBeInTheDocument();
    expect(screen.getByText(/no email/i)).toBeInTheDocument(); // for Bob (empty email)
    // Dividers between items: 2 separators for 3 users
    expect(screen.getAllByRole('separator')).toHaveLength(2);

    // Non-admin view: no detail line
    getMock.mockClear();
    resolveUsers(users);
    rerender(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);
    await screen.findByText('Users');
    expect(screen.queryByText(/example\.com/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/111-222/i)).not.toBeInTheDocument();
  });

  test('401 error clears localStorage and reloads page', async () => {
    rejectUsers({ response: { status: 401, data: { error: 'Unauthorized' } } });
    render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);

    // Should trigger reload after clearing storage
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalled();
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  test('403 error shows "Admin access required"', async () => {
    rejectUsers({ response: { status: 403 } });
    render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Admin access required');
  });

  test('generic error shows server message or fallback', async () => {
    // With server error message
    rejectUsers({ response: { status: 500, data: { error: 'Server blew up' } } });
    const { rerender } = render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server blew up');

    // Without message -> fallback
    cleanup();
    rejectUsers({ response: { status: 500 } });
    render(<UsersList currentUser={{ id: 'me', role: 'USER' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch users');
  });
});
