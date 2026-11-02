// --- Mock axios client FIRST to avoid parsing import.meta in the real file ---
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

// Mock the same authenticated user hook used by AdminRoute.
let mockCurrentUser = null;

jest.mock('@/context/UserContext', () => ({
  useUser: () => ({ currentUser: mockCurrentUser }),
}));

// --- Now import test utils and SUT ---
import { render, screen, waitFor } from '../../__tests__/test-utils.js';
import UsersAdminPage from '@/pages/UsersAdminPage.js';

describe('UsersAdminPage', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = null;
  });

  test('admin loads user list', async () => {
    const admin = { id: 1, username: 'root', role: 'ADMIN', plan: 'PREMIUM' };
    mockGet.mockResolvedValueOnce({ data: { users: [{ id: 10, username: 'alice' }] } });

    mockCurrentUser = admin;
    render(<UsersAdminPage />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/admin/users');
      expect(screen.getByText(/alice/i)).toBeInTheDocument();
    });
  });

  test('signed-out visitor cannot load administrator users', () => {
    mockCurrentUser = null;

    render(<UsersAdminPage />);

    expect(screen.getByText(/Forbidden.*admin only/i)).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('shows an authorization error instead of an empty list', async () => {
    mockCurrentUser = { id: 1, role: 'ADMIN' };

    mockGet.mockRejectedValueOnce({
      response: { status: 403 },
    });

    render(<UsersAdminPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session is not authorized to view users.'
    );

    expect(screen.queryByText('No users found.')).not.toBeInTheDocument();
  });

  test('shows a loading error when the API is unavailable', async () => {
    mockCurrentUser = { id: 1, role: 'ADMIN' };

    mockGet.mockRejectedValueOnce({
      response: { status: 500 },
    });

    render(<UsersAdminPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load users.'
    );

    expect(screen.queryByText('No users found.')).not.toBeInTheDocument();
  });

  test('shows an empty state only after a successful empty response', async () => {
    mockCurrentUser = { id: 1, role: 'ADMIN' };

    mockGet.mockResolvedValueOnce({
      data: { items: [], total: 0 },
    });

    render(<UsersAdminPage />);

    expect(await screen.findByText('No users found.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('non-admin blocked', () => {
    const peasant = { id: 2, username: 'bob', role: 'USER', plan: 'PREMIUM' };
    mockCurrentUser = peasant;
    render(<UsersAdminPage />);

    const blocked = screen.queryByText(/forbidden|not authorized|admin only/i);
    expect(blocked).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
