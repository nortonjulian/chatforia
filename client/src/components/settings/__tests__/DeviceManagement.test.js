import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DeviceManagement from '@/components/DeviceManagement';

// -------------------- Mocks --------------------

// Mantine primitives (light shims)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tag) => ({ children, ...p }) => React.createElement(tag || 'div', p, children);

  const ActionIcon = ({ children, onClick, ...p }) => (
    <button type="button" aria-label={p['aria-label'] || 'action'} onClick={onClick} {...p}>
      {children}
    </button>
  );
  const Badge = ({ children, ...p }) => <span role="status" {...p}>{children}</span>;
  const Button = ({ children, onClick, ...p }) => <button type="button" onClick={onClick} {...p}>{children}</button>;
  const Card = passthru('div');
  const Group = ({ children, ...p }) => <div data-testid="group" {...p}>{children}</div>;
  const Loader = () => <div role="progressbar" />;
  const Modal = ({ opened, onClose, title, children, centered }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        <button aria-label="close-modal" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;
  const ScrollArea = ({ children }) => <div data-testid="scrollarea">{children}</div>;
  const Table = Object.assign(
    ({ children, ...p }) => <table {...p}>{children}</table>,
    {
      Thead: ({ children }) => <thead>{children}</thead>,
      Tbody: ({ children }) => <tbody>{children}</tbody>,
      Tr: ({ children, ...p }) => <tr {...p}>{children}</tr>,
      Th: ({ children, ...p }) => <th {...p}>{children}</th>,
      Td: ({ children, ...p }) => <td {...p}>{children}</td>,
    }
  );
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  const TextInput = ({ label, value, onChange, ...p }) => (
    <label>
      {label}
      <input aria-label={label} value={value} onChange={onChange} {...p} />
    </label>
  );
  const Tooltip = ({ label, children }) => <div data-testid="tooltip" data-label={label}>{children}</div>;

  return { ActionIcon, Badge, Button, Card, Group, Loader, Modal, ScrollArea, Table, Text, TextInput, Tooltip };
});

// Icons (not needed for behavior)
jest.mock('@tabler/icons-react', () => ({
  IconLink: () => <i />,
  IconLogout: () => <i />,
  IconPencil: () => <i />,
  IconRefresh: () => <i />,
  IconShield: () => <i />,
}));

// Link modal (render a stub you can close)
const LinkFlowPrimaryModalMock = jest.fn(({ opened, onClose }) =>
  opened ? (
    <div data-testid="link-modal">
      <button onClick={onClose}>Close link modal</button>
    </div>
  ) : null
);
jest.mock('@/components/LinkFlowPrimaryModal.jsx', () => ({
  __esModule: true,
  default: (p) => LinkFlowPrimaryModalMock(p),
}));

// useUser
jest.mock('@/context/UserContext.js', () => ({
  useUser: () => ({ user: { id: 'user-1' } }),
}));

// useDeviceEvents: capture handlers so tests can trigger them
let capturedHandlers = null;
jest.mock('@/hooks/useDeviceEvents.js', () => ({
  useDeviceEvents: (handlers) => {
    capturedHandlers = handlers;
  },
}));

// fetch global
const fetchMock = jest.fn();
global.fetch = fetchMock;

beforeEach(() => {
  jest.clearAllMocks();
  capturedHandlers = null;
});

// -------------------- Helpers --------------------
function mockGetDevicesOnce(list) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => list,
  });
}

function mockPostOkOnce() {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
}

async function renderWithInitialDevices(list) {
  mockGetDevicesOnce(list);
  render(<DeviceManagement />);
  // Wait until loader is gone and table appears
  await screen.findByText(/your devices/i);
  return screen.getByTestId('scrollarea');
}

// -------------------- Tests --------------------
describe('DeviceManagement', () => {
  test('shows loader, fetches devices, and renders rows with badges/actions', async () => {
    const nowIso = new Date('2025-01-01T10:00:00Z').toISOString();
    const list = [
      { id: 'a', name: 'MacBook', platform: 'macOS', isPrimary: true, createdAt: nowIso, lastSeenAt: nowIso },
      { id: 'b', name: 'Old Phone', platform: 'Android', isPrimary: false, revokedAt: nowIso, createdAt: nowIso },
    ];

    const area = await renderWithInitialDevices(list);

    // Table headers present
    expect(screen.getByText(/device/i)).toBeInTheDocument();
    expect(screen.getByText(/added/i)).toBeInTheDocument();
    expect(screen.getByText(/activity/i)).toBeInTheDocument();
    expect(screen.getByText(/actions/i)).toBeInTheDocument();

    // First row (primary) shows Primary badge and action buttons
    expect(screen.getByText('MacBook')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Primary/i })).toBeInTheDocument();
    // Rename + Revoke buttons exist for non-revoked
    expect(screen.getAllByRole('button', { name: 'action' }).length).toBeGreaterThan(0);

    // Second row (revoked) shows Revoked badge and no actions
    expect(screen.getByText('Old Phone')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Revoked/i })).toBeInTheDocument();

    // Initial GET call shape
    expect(fetchMock).toHaveBeenCalledWith('/devices', { credentials: 'include' });
  });

  test('rename flow: opens modal with prefilled name, posts, closes, and reloads list', async () => {
    const list = [{ id: 'x1', name: 'Laptop', platform: 'macOS', createdAt: Date.now(), lastSeenAt: Date.now() }];

    // initial load
    await renderWithInitialDevices(list);

    // Open rename modal (first action icon is rename in our row order)
    const renameBtn = screen.getAllByRole('button', { name: 'action' })[0];
    fireEvent.click(renameBtn);

    const dlg = screen.getByRole('dialog', { name: /rename device/i });
    const input = within(dlg).getByLabelText(/name/i);
    expect(input).toHaveValue('Laptop');

    // Type new name and submit
    fireEvent.change(input, { target: { value: 'Work Laptop' } });

    // POST /devices/rename/x1
    mockPostOkOnce();
    // Reload devices returns updated name
    mockGetDevicesOnce([{ id: 'x1', name: 'Work Laptop', platform: 'macOS', createdAt: Date.now() }]);

    fireEvent.click(within(dlg).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/devices/rename/x1', expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: JSON.stringify({ name: 'Work Laptop' }),
      }));
    });

    // Modal closes (no dialog)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /rename device/i })).not.toBeInTheDocument();
    });

    // New name shows after reload
    await screen.findByText('Work Laptop');
  });

  test('revoke flow posts and reloads', async () => {
    const list = [{ id: 'r1', name: 'Pixel', platform: 'Android', createdAt: Date.now() }];
    await renderWithInitialDevices(list);

    // Second action icon is revoke (after rename)
    const buttons = screen.getAllByRole('button', { name: 'action' });
    const revokeBtn = buttons[1];

    // POST revoke + then reload GET
    mockPostOkOnce();
    mockGetDevicesOnce([{ id: 'r1', name: 'Pixel', platform: 'Android', revokedAt: Date.now() }]);

    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/devices/revoke/r1', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }));
    });

    // After reload, show Revoked badge
    await screen.findByRole('status', { name: /revoked/i });
  });

  test('link new device opens modal; closing it triggers reload', async () => {
    await renderWithInitialDevices([]);

    // Open link modal
    fireEvent.click(screen.getByRole('button', { name: /link new device/i }));
    expect(LinkFlowPrimaryModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ opened: true, onClose: expect.any(Function) })
    );

    // When modal closes, it should trigger refresh -> GET called again
    mockGetDevicesOnce([{ id: 'n1', name: 'New Device', createdAt: Date.now() }]);
    fireEvent.click(screen.getByText(/close link modal/i));

    await screen.findByText('New Device');
  });

  test('manual refresh button triggers reload', async () => {
    await renderWithInitialDevices([{ id: 'd1', name: 'One', createdAt: Date.now() }]);

    mockGetDevicesOnce([{ id: 'd1', name: 'One', createdAt: Date.now() }, { id: 'd2', name: 'Two', createdAt: Date.now() }]);
    // The ActionIcon without label is our refresh; use title via Icon not available, so select by role count:
    const refreshBtn = screen.getAllByRole('button', { name: 'action' }).slice(-1)[0];
    fireEvent.click(refreshBtn);

    await screen.findByText('Two');
  });

  test('live device events (linked/revoked) trigger reloads', async () => {
    await renderWithInitialDevices([{ id: 'a', name: 'Alpha', createdAt: Date.now() }]);
    expect(capturedHandlers).toBeTruthy();

    // onLinked should bump refresh
    mockGetDevicesOnce([{ id: 'a', name: 'Alpha', createdAt: Date.now() }, { id: 'b', name: 'Beta', createdAt: Date.now() }]);
    capturedHandlers.onLinked?.();
    await screen.findByText('Beta');

    // onRevoked should also bump refresh
    mockGetDevicesOnce([{ id: 'a', name: 'Alpha', revokedAt: Date.now() }]);
    capturedHandlers.onRevoked?.();
    await screen.findByRole('status', { name: /revoked/i });
  });

  test('shows loader while loading', async () => {
    // Keep the first GET pending briefly to assert loader
    let resolve;
    const pending = new Promise((r) => (resolve = r));
    fetchMock.mockReturnValueOnce(pending);

    render(<DeviceManagement />);

    // Loader visible
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // Finish GET
    resolve({ ok: true, json: async () => [] });

    // Table renders after completion
    await screen.findByText(/your devices/i);
  });
});
