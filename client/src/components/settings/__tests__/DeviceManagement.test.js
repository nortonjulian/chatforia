import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DeviceManagement from '../DeviceManagement.jsx';

// -------------------- Mocks --------------------

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
  const Modal = ({ opened, onClose, title, children }) =>
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

jest.mock('@tabler/icons-react', () => ({
  IconLink: () => <i />,
  IconLogout: () => <i />,
  IconPencil: () => <i />,
  IconRefresh: () => <i />,
  IconShield: () => <i />,
}));

const mockLinkFlowPrimaryModal = jest.fn(({ opened, onClose }) =>
  opened ? (
    <div data-testid="link-modal">
      <button onClick={onClose}>Close link modal</button>
    </div>
  ) : null
);
jest.mock('../LinkFlowPrimaryModal.jsx', () => ({
  __esModule: true,
  default: (p) => mockLinkFlowPrimaryModal(p),
}));

jest.mock('../../../context/UserContext', () => ({
  useUser: () => ({ user: { id: 'user-1' } }),
}));

let capturedHandlers = null;
jest.mock('../../../hooks/useDeviceEvents', () => ({
  useDeviceEvents: (handlers) => {
    capturedHandlers = handlers;
  },
}));

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
  // Wait until table container renders (loader finished)
  await screen.findByTestId('scrollarea');
  return screen.getByTestId('scrollarea');
}

function clickTooltipAction(labelText) {
  const tooltips = screen.getAllByTestId('tooltip');
  const tip = tooltips.find((t) => t.getAttribute('data-label') === labelText);
  if (!tip) throw new Error(`Tooltip with label "${labelText}" not found`);
  const btn = within(tip).getByRole('button', { name: 'action' });
  fireEvent.click(btn);
}

function headerRefreshButton() {
  // header is the first Group (title + actions)
  const header = screen.getAllByTestId('group')[0];
  return within(header).getByRole('button', { name: 'action' });
}

// -------------------- Tests --------------------
describe('DeviceManagement', () => {
  test('shows loader, fetches devices, and renders rows with badges/actions', async () => {
    const nowIso = new Date('2025-01-01T10:00:00Z').toISOString();
    const list = [
      { id: 'a', name: 'MacBook', platform: 'macOS', isPrimary: true, createdAt: nowIso, lastSeenAt: nowIso },
      { id: 'b', name: 'Old Phone', platform: 'Android', isPrimary: false, revokedAt: nowIso, createdAt: nowIso },
    ];

    await renderWithInitialDevices(list);

    // Table headers present (avoid text "Device" vs "Your devices" ambiguity)
    ['Device', 'Added', 'Activity', 'Actions'].forEach((h) => {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    });

    // Row content
    expect(screen.getByText('MacBook')).toBeInTheDocument();
    // 👇 Robust check for Primary badge text (accessible name is empty in our shim)
    const statuses1 = screen.getAllByRole('status');
    expect(statuses1.some((el) => /primary/i.test(el.textContent || ''))).toBe(true);

    expect(screen.getByText('Old Phone')).toBeInTheDocument();
    // 👇 Same robust check for Revoked in this test
    const statuses2 = screen.getAllByRole('status');
    expect(statuses2.some((el) => /revoked/i.test(el.textContent || ''))).toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('/devices', { credentials: 'include' });
  });

  test('rename flow: opens modal with prefilled name, posts, closes, and reloads list', async () => {
    const list = [{ id: 'x1', name: 'Laptop', platform: 'macOS', createdAt: Date.now(), lastSeenAt: Date.now() }];
    await renderWithInitialDevices(list);

    clickTooltipAction('Rename');

    const dlg = screen.getByRole('dialog', { name: /rename device/i });
    const input = within(dlg).getByLabelText(/name/i);
    expect(input).toHaveValue('Laptop');

    fireEvent.change(input, { target: { value: 'Work Laptop' } });

    mockPostOkOnce();
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

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /rename device/i })).not.toBeInTheDocument();
    });

    await screen.findByText('Work Laptop');
  });

  test('revoke flow posts and reloads', async () => {
    const list = [{ id: 'r1', name: 'Pixel', platform: 'Android', createdAt: Date.now() }];
    await renderWithInitialDevices(list);

    mockPostOkOnce();
    mockGetDevicesOnce([{ id: 'r1', name: 'Pixel', platform: 'Android', revokedAt: Date.now() }]);
    clickTooltipAction('Revoke access');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/devices/revoke/r1', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }));
    });

    const statuses = await screen.findAllByRole('status');
    expect(statuses.some((el) => /revoked/i.test(el.textContent || ''))).toBe(true);
  });

  test('link new device opens modal; closing it triggers reload', async () => {
    await renderWithInitialDevices([]);

    fireEvent.click(screen.getByRole('button', { name: /link new device/i }));
    expect(mockLinkFlowPrimaryModal).toHaveBeenCalledWith(
      expect.objectContaining({ opened: true, onClose: expect.any(Function) })
    );

    mockGetDevicesOnce([{ id: 'n1', name: 'New Device', createdAt: Date.now() }]);
    fireEvent.click(screen.getByText(/close link modal/i));

    await screen.findByText('New Device');
  });

  test('manual refresh button triggers reload', async () => {
    await renderWithInitialDevices([{ id: 'd1', name: 'One', createdAt: Date.now() }]);

    mockGetDevicesOnce([
      { id: 'd1', name: 'One', createdAt: Date.now() },
      { id: 'd2', name: 'Two', createdAt: Date.now() },
    ]);

    fireEvent.click(headerRefreshButton());

    await screen.findByText('Two');
  });

  test('live device events (linked/revoked) trigger reloads', async () => {
    await renderWithInitialDevices([{ id: 'a', name: 'Alpha', createdAt: Date.now() }]);
    expect(capturedHandlers).toBeTruthy();

    mockGetDevicesOnce([{ id: 'a', name: 'Alpha', createdAt: Date.now() }, { id: 'b', name: 'Beta', createdAt: Date.now() }]);
    capturedHandlers.onLinked?.();
    await screen.findByText('Beta');

    mockGetDevicesOnce([{ id: 'a', name: 'Alpha', revokedAt: Date.now() }]);
    capturedHandlers.onRevoked?.();

    const statuses = await screen.findAllByRole('status');
    expect(statuses.some((el) => /revoked/i.test(el.textContent || ''))).toBe(true);
  });

  test('shows loader while loading', async () => {
    let resolve;
    const pending = new Promise((r) => (resolve = r));
    fetchMock.mockReturnValueOnce(pending);

    render(<DeviceManagement />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    resolve({ ok: true, json: async () => [] });

    await screen.findByTestId('scrollarea');
    await screen.findByText(/your devices/i);
  });
});
