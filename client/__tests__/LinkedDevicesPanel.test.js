import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import LinkedDevicesPanel from '@/components/LinkedDevicesPanel'; // keep alias import

// -------------------- Mocks --------------------

// Minimal Mantine mocks (HTML primitives)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Noop = ({ children, ...p }) => <div {...p}>{children}</div>;

  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const ActionIcon = ({ children, onClick, disabled, 'aria-label': aria, ...p }) => (
    <button type="button" aria-label={aria} onClick={onClick} disabled={disabled} {...p}>
      {children}
    </button>
  );
  const Skeleton = ({ h, ...p }) => <div role="progressbar" data-h={h} {...p} />;

  const Tooltip = ({ children }) => <>{children}</>;
  const Badge = ({ children, ...p }) => <span data-testid="badge" {...p}>{children}</span>;
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;

  return {
    Card: Noop,
    Group: Noop,
    Text,
    Button,
    Stack: Noop,
    Skeleton,
    Badge,
    ActionIcon,
    Tooltip,
  };
});

// Icons not relevant to behavior
jest.mock('@tabler/icons-react', () => ({
  IconRefresh: (p) => <span data-testid="icon-refresh" {...p} />,
  IconPencil: (p) => <span data-testid="icon-pencil" {...p} />,
  IconTrash: (p) => <span data-testid="icon-trash" {...p} />,
}));

// axios client — name variables with "mock*" so Jest allows capture
const mockGet = jest.fn();
const mockPost = jest.fn();

// Mock by alias path
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

// Also mock the relative path some components might use (../api/axiosClient)
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

// Provide a global toast (the component references toast.ok/err)
global.toast = {
  ok: jest.fn(),
  err: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper to resolve initial GET
function resolveDevices(data) {
  mockGet.mockResolvedValueOnce({ data });
}
function rejectDevices(error) {
  mockGet.mockRejectedValueOnce(error instanceof Error ? error : Object.assign(new Error('x'), error));
}

describe('LinkedDevicesPanel', () => {
  test('initially loads devices (once), shows loading skeletons, and supports Refresh', async () => {
    // Keep first promise pending while we check loading UI
    let resolvePending;
    const pending = new Promise((r) => { resolvePending = r; });
    mockGet.mockReturnValueOnce(pending);

    render(<LinkedDevicesPanel />);

    // Loading: two skeletons present
    const skels = screen.getAllByRole('progressbar');
    expect(skels).toHaveLength(2);

    // Finish first request -> empty list
    resolvePending({ data: [] });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/no linked devices/i)).toBeInTheDocument();

    // Click Refresh -> triggers another GET
    resolveDevices([]);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  test('404 on fetch does not toast an error and shows empty state', async () => {
    rejectDevices({ response: { status: 404 } });
    render(<LinkedDevicesPanel />);

    // After error handling, should show empty state and no toast
    await waitFor(() => {
      expect(screen.getByText(/no linked devices found/i)).toBeInTheDocument();
    });
    expect(global.toast.err).not.toHaveBeenCalled();
  });

  test('renders populated list with badges and action buttons', async () => {
    const devices = [
      {
        id: 'a',
        name: 'MacBook Pro',
        isPrimary: true,
        platform: 'macOS',
        createdAt: '2024-01-01T12:00:00Z',
        lastSeenAt: '2024-01-02T12:00:00Z',
      },
      {
        id: 'b',
        name: '',
        platform: 'iOS',
        createdAt: null,
        lastSeenAt: null,
      },
    ];
    resolveDevices(devices);
    render(<LinkedDevicesPanel />);

    // Names (fallback to "Unnamed device" for empty name)
    expect(await screen.findByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.getByText('Unnamed device')).toBeInTheDocument();

    // Badges: Primary + platform
    const badges = screen.getAllByTestId('badge').map((b) => b.textContent);
    expect(badges).toEqual(expect.arrayContaining(['Primary', 'macOS', 'iOS']));

    // Action buttons visible
    expect(screen.getAllByRole('button', { name: /rename device/i }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: /revoke device/i }).length).toBe(2);

    // Last seen / added line exists (we don't assert exact date string)
    expect(screen.getAllByText(/added/i).length).toBe(2);
  });

  test('rename: cancel prompt -> no call; success -> POST, UI update, toast.ok; failure -> toast.err', async () => {
    resolveDevices([{ id: 'x', name: 'Old Name' }]);
    render(<LinkedDevicesPanel />);
    await screen.findByText('Old Name');

    const renameBtn = screen.getByRole('button', { name: /rename device/i });

    // Cancel (returns null/empty) => no POST
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('');
    fireEvent.click(renameBtn);
    expect(mockPost).not.toHaveBeenCalled();

    // Success path
    promptSpy.mockReturnValue(' New Name ');
    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    fireEvent.click(renameBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/devices/rename/x', { name: 'New Name' });
    });

    // UI updated + success toast
    expect(await screen.findByText('New Name')).toBeInTheDocument();
    expect(global.toast.ok).toHaveBeenCalledWith('Device renamed');

    // Failure path
    promptSpy.mockReturnValue('Another Name');
    mockPost.mockRejectedValueOnce(new Error('rename failed'));
    fireEvent.click(renameBtn);

    await waitFor(() => expect(global.toast.err).toHaveBeenCalledWith('Could not rename device'));
  });

  test('revoke: success marks as Revoked and disables actions; failure toasts error', async () => {
    resolveDevices([{ id: 'y', name: 'iPhone', platform: 'iOS' }]);
    render(<LinkedDevicesPanel />);
    await screen.findByText('iPhone');

    const revokeBtn = screen.getByRole('button', { name: /revoke device/i });
    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    fireEvent.click(revokeBtn);

    // “Revoked” badge appears and actions disabled
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    const revokeBtn2 = screen.getByRole('button', { name: /revoke device/i });
    const renameBtn2 = screen.getByRole('button', { name: /rename device/i });
    expect(revokeBtn2).toBeDisabled();
    expect(renameBtn2).toBeDisabled();

    expect(global.toast.ok).toHaveBeenCalledWith('Device revoked');

    // Failure path
    resolveDevices([{ id: 'z', name: 'Pixel' }]);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await screen.findByText('Pixel');

    mockPost.mockRejectedValueOnce(new Error('revoke failed'));
    const revokeBtn3 = screen.getByRole('button', { name: /revoke device/i });
    fireEvent.click(revokeBtn3);

    await waitFor(() => {
      expect(global.toast.err).toHaveBeenCalledWith('Could not revoke device');
    });
  });
});
