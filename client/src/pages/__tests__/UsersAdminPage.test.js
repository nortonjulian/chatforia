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

// --- Now import test utils and SUT ---
import { render, screen, waitFor, withUser } from '../../__tests__/test-utils.js';
import UsersAdminPage from '@/pages/UsersAdminPage.js';

describe('UsersAdminPage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('admin loads user list', async () => {
    const admin = { id: 1, username: 'root', role: 'ADMIN', plan: 'PREMIUM' };
    mockGet.mockResolvedValueOnce({ data: { users: [{ id: 10, username: 'alice' }] } });

    // Pass currentUser so the page doesn't render "Forbidden"
    render(<UsersAdminPage currentUser={admin} />, { wrapper: withUser(admin) });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/admin/users');
      expect(screen.getByText(/alice/i)).toBeInTheDocument();
    });
  });

  test('non-admin blocked', () => {
    const peasant = { id: 2, username: 'bob', role: 'USER', plan: 'PREMIUM' };
    render(<UsersAdminPage />, { wrapper: withUser(peasant) });

    const blocked = screen.queryByText(/forbidden|not authorized|admin only/i);
    expect(blocked).toBeTruthy();
  });
});
