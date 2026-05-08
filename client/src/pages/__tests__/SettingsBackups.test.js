import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* ---------------- Mantine stubs ---------------- */
jest.mock('@mantine/core', () => {
  const React = require('react');

  const stripDomProps = (props = {}) => {
    const {
      withBorder,
      radius,
      p,
      gap,
      justify,
      c,
      description,
      ...rest
    } = props;

    return rest;
  };

  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...stripDomProps(props)}>
      {children}
    </div>
  );

  const Title = ({ order = 3, children, ...props }) => {
    const HeadingTag = `h${order}`;
    return (
      <HeadingTag data-testid="title" {...stripDomProps(props)}>
        {children}
      </HeadingTag>
    );
  };

  const Stack = passthru('stack');
  const Card = passthru('card');
  const Group = passthru('group');

  const Text = ({ children, ...props }) => (
    <div {...stripDomProps(props)}>{children}</div>
  );

  const Button = ({ children, onClick, disabled, ...props }) => (
    <button onClick={onClick} disabled={!!disabled} {...stripDomProps(props)}>
      {children}
    </button>
  );

  const PasswordInput = ({ label, value, onChange, ...props }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="password"
        value={value || ''}
        onChange={onChange}
        {...stripDomProps(props)}
      />
    </label>
  );

  return {
    __esModule: true,
    Card,
    Stack,
    Title,
    PasswordInput,
    Group,
    Button,
    Text,
  };
});

/* ---------------- Child component stubs ---------------- */
jest.mock('../../components/KeyBackupManager.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="key-backup-manager">key backup</div>,
}));

jest.mock('../../components/settings/ChatBackupManager.jsx', () => ({
  __esModule: true,
  default: ({ fetchPage }) => (
    <div data-testid="chat-backup-manager">
      <button
        type="button"
        onClick={async () => {
          const statusEl = global.document.querySelector(
            '[data-testid="fetch-status"]'
          );

          try {
            await fetchPage();
            if (statusEl) statusEl.textContent = 'fetch-ok';
          } catch {
            if (statusEl) statusEl.textContent = 'fetch-error';
          }
        }}
      >
        run-fetch
      </button>
    </div>
  ),
}));

/* ---------------- Encryption loader ---------------- */
const mockUnlockKeyBundle = jest.fn();

jest.mock('../../utils/loadEncryptionClient', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    unlockKeyBundle: (...args) => mockUnlockKeyBundle(...args),
  })),
}));

/* ---------------- SUT ---------------- */
import SettingsBackups from '../SettingsBackups';
import loadEncryptionClient from '../../utils/loadEncryptionClient';

describe('SettingsBackups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnlockKeyBundle.mockReset();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('renders title, KeyBackupManager, and ChatBackupManager', () => {
    render(<SettingsBackups />);

    expect(
      screen.getByRole('heading', { name: /^Backups$/i })
    ).toBeInTheDocument();

    expect(screen.getByTestId('key-backup-manager')).toBeInTheDocument();
    expect(screen.getByTestId('chat-backup-manager')).toBeInTheDocument();
  });

  test('unlock button disabled until passcode >= 6; success path sets status', async () => {
    mockUnlockKeyBundle.mockResolvedValueOnce({ privateKey: 'PK_BASE64' });

    render(<SettingsBackups />);

    const unlockBtn = screen.getByRole('button', { name: /^unlock$/i });
    expect(unlockBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
      target: { value: '12345' },
    });
    expect(unlockBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
      target: { value: '123456' },
    });
    expect(unlockBtn).not.toBeDisabled();

    fireEvent.click(unlockBtn);

    await waitFor(() => {
      expect(loadEncryptionClient).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockUnlockKeyBundle).toHaveBeenCalledWith('123456');
    });

    expect(await screen.findByText(/Unlocked ✓/i)).toBeInTheDocument();
  });

  test('unlock failure shows error status', async () => {
    mockUnlockKeyBundle.mockRejectedValueOnce(new Error('bad pass'));

    render(<SettingsBackups />);

    fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
      target: { value: 'hunter2' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));

    expect(await screen.findByText(/Error: bad pass/i)).toBeInTheDocument();
  });

  test('unlock failure handles missing encryption client function', async () => {
    loadEncryptionClient.mockResolvedValueOnce({});

    render(<SettingsBackups />);

    fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));

    expect(
      await screen.findByText(/Error: Encryption client not available/i)
    ).toBeInTheDocument();
  });

  test('fetchAllMessages hits /messages/all?limit=5000 with credentials and handles success', async () => {
    const jsonMock = jest.fn().mockResolvedValue({ items: [] });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jsonMock,
    });

    render(
      <div>
        <SettingsBackups />
        <div data-testid="fetch-status" />
      </div>
    );

    fireEvent.click(screen.getByText('run-fetch'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/messages/all?limit=5000',
        expect.objectContaining({ credentials: 'include' })
      );
    });

    await waitFor(() => {
      expect(jsonMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('fetch-status')).toHaveTextContent('fetch-ok');
  });

  test('fetchAllMessages error path shows fetch-error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
    });

    render(
      <div>
        <SettingsBackups />
        <div data-testid="fetch-status" />
      </div>
    );

    fireEvent.click(screen.getByText('run-fetch'));

    await waitFor(() => {
      expect(screen.getByTestId('fetch-status')).toHaveTextContent(
        'fetch-error'
      );
    });
  });
});