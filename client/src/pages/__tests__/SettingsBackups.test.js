import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mantine stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );
  const Title = ({ children, ...p }) => <h3 data-testid="title" {...p}>{children}</h3>;
  const Stack = passthru('stack');
  const Card = passthru('card');
  const Group = passthru('group');
  const Text = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Button = ({ children, onClick, disabled, ...p }) => (
    <button onClick={onClick} disabled={!!disabled} {...p}>{children}</button>
  );
  const PasswordInput = ({ label, value, onChange, ...p }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="password"
        value={value || ''}
        onChange={onChange}
        {...p}
      />
    </label>
  );
  return { __esModule: true, Card, Stack, Title, PasswordInput, Group, Button, Text };
});

// ---- Children component stubs ----
jest.mock('../components/settings/BackupManager.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="backup-manager">backup</div>,
}));

// ChatBackupManager stub exposes a button to invoke fetchAllMessages
jest.mock('../components/ChatBackupManager.jsx', () => ({
  __esModule: true,
  default: ({ fetchAllMessages, currentUserId, currentUserPrivateKey }) => (
    <div
      data-testid="chat-backup"
      data-currentuserid={String(currentUserId)}
      data-privatekey={currentUserPrivateKey || ''}
    >
      <button
        onClick={async () => {
          try {
            const res = await fetchAllMessages();
            const ok = res && (res.items || res.data || res).length >= 0;
            const el = document.querySelector('[data-testid="fetch-status"]');
            if (el) el.textContent = ok ? 'fetch-ok' : 'fetch-empty';
          } catch (e) {
            const el = document.querySelector('[data-testid="fetch-status"]');
            if (el) el.textContent = 'fetch-error';
          }
        }}
      >
        run-fetch
      </button>
    </div>
  ),
}));

// ---- Encryption client ----
const unlockKeyBundle = jest.fn();
jest.mock('../utils/encryptionClient.js', () => ({
  __esModule: true,
  unlockKeyBundle: (...a) => unlockKeyBundle(...a),
}));

// ---- SUT ----
import SettingsBackups from './SettingsBackups';

describe('SettingsBackups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders title and BackupManager', () => {
    render(<SettingsBackups />);
    expect(screen.getByTestId('title')).toHaveTextContent(/Backups/i);
    expect(screen.getByTestId('backup-manager')).toBeInTheDocument();
  });

  test('unlock button disabled until passcode >= 6; success path sets status and passes key to ChatBackupManager', async () => {
    unlockKeyBundle.mockResolvedValueOnce({ privateKey: 'PK_BASE64' });

    render(
      <div>
        <SettingsBackups />
        <div data-testid="fetch-status" />
      </div>
    );

    const unlockBtn = screen.getByRole('button', { name: /unlock/i });
    expect(unlockBtn).toBeDisabled();

    // Too short
    fireEvent.change(screen.getByLabelText(/Unlock passcode/i), { target: { value: '12345' } });
    expect(unlockBtn).toBeDisabled();

    // Valid length
    fireEvent.change(screen.getByLabelText(/Unlock passcode/i), { target: { value: '123456' } });
    expect(unlockBtn).not.toBeDisabled();

    fireEvent.click(unlockBtn);

    await waitFor(() => expect(unlockKeyBundle).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(screen.getByText(/Unlocked ✓/i)).toBeInTheDocument());

    // Private key flowed into ChatBackupManager stub
    const chat = screen.getByTestId('chat-backup');
    expect(chat).toHaveAttribute('data-privatekey', 'PK_BASE64');
  });

  test('unlock failure shows error status', async () => {
    unlockKeyBundle.mockRejectedValueOnce(new Error('bad pass'));

    render(<SettingsBackups />);

    fireEvent.change(screen.getByLabelText(/Unlock passcode/i), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(screen.getByText(/Error: bad pass/i)).toBeInTheDocument();
    });
  });

  test('fetchAllMessages hits /messages/all?limit=5000 with credentials and handles success', async () => {
    // Mock fetch success
    const jsonMock = jest.fn().mockResolvedValue({ items: [] });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: jsonMock });
    const ogFetch = global.fetch;
    global.fetch = fetchMock;

    render(
      <div>
        <SettingsBackups />
        <div data-testid="fetch-status" />
      </div>
    );

    fireEvent.click(screen.getByText('run-fetch'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/messages/all?limit=5000', expect.objectContaining({ credentials: 'include' }));
    });
    await waitFor(() => expect(screen.getByTestId('fetch-status')).toHaveTextContent('fetch-ok'));

    global.fetch = ogFetch;
  });

  test('fetchAllMessages error path shows fetch-error', async () => {
    // Mock fetch non-ok
    const fetchMock = jest.fn().mockResolvedValue({ ok: false });
    const ogFetch = global.fetch;
    global.fetch = fetchMock;

    render(
      <div>
        <SettingsBackups />
        <div data-testid="fetch-status" />
      </div>
    );

    fireEvent.click(screen.getByText('run-fetch'));
    await waitFor(() => expect(screen.getByTestId('fetch-status')).toHaveTextContent('fetch-error'));

    global.fetch = ogFetch;
  });

  test('currentUserId prop is undefined (as written)', () => {
    render(<SettingsBackups />);
    const chat = screen.getByTestId('chat-backup');
    expect(chat).toHaveAttribute('data-currentuserid', 'undefined');
  });
});
