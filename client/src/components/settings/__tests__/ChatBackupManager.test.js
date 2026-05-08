import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatBackupManager from '@/components/settings/ChatBackupManager.jsx';
import '@testing-library/jest-dom';

const mockCreateEncryptedChatBackup = jest.fn();
const mockRestoreEncryptedChatBackup = jest.fn();

jest.mock('@/utils/backupClient.js', () => ({
  __esModule: true,
  createEncryptedChatBackup: (...args) => mockCreateEncryptedChatBackup(...args),
  restoreEncryptedChatBackup: (...args) => mockRestoreEncryptedChatBackup(...args),
}));

jest.mock('@mantine/core', () => {
  const React = require('react');

  return {
    __esModule: true,
    Card: ({ children }) => <div>{children}</div>,
    Stack: ({ children }) => <div>{children}</div>,
    Group: ({ children }) => <div>{children}</div>,
    Text: ({ children }) => <p>{children}</p>,
    Divider: ({ label }) => <hr aria-label={label} />,

    Button: ({ children, disabled, loading, onClick }) => (
      <button type="button" disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    ),

    PasswordInput: ({ label, value, onChange }) => (
      <label>
        {label}
        <input
          aria-label={label}
          type="password"
          value={value}
          onChange={onChange}
        />
      </label>
    ),

    FileInput: ({ label, onChange, accept }) => (
      <label>
        {label}
        <input
          aria-label={label}
          type="file"
          accept={accept}
          data-testid="backup-file-input"
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
      </label>
    ),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: jest.fn(),
      configurable: true,
    });
  }

  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true,
    });
  }

  jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function setup(props = {}) {
  const fetchPage = jest.fn();
  const fetchPublicKeys = jest.fn();

  render(
    <ChatBackupManager
      currentUserId="u1"
      roomId="r1"
      fetchPage={fetchPage}
      fetchPublicKeys={fetchPublicKeys}
      {...props}
    />
  );

  return { fetchPage, fetchPublicKeys };
}

const exportPasswordInput = () =>
  screen.getAllByLabelText(/^backup password$/i)[0];

const restorePasswordInput = () =>
  screen.getAllByLabelText(/^backup password$/i)[1];

function attachFile(file) {
  const input = screen.getByTestId('backup-file-input');

  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });

  fireEvent.change(input);
}

test('export button is disabled until required inputs are valid', () => {
  setup();

  expect(
    screen.getByRole('button', { name: /download encrypted chat backup/i })
  ).toBeDisabled();
});

test('creates encrypted chat backup and downloads it', async () => {
  const blob = new Blob(['{}'], { type: 'application/json' });

  mockCreateEncryptedChatBackup.mockResolvedValueOnce({
    blob,
    filename: 'chat-backup.json',
  });

  const { fetchPage, fetchPublicKeys } = setup();

  fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
    target: { value: '123456' },
  });

  fireEvent.change(exportPasswordInput(), {
    target: { value: 'abcdef' },
  });

  const button = screen.getByRole('button', {
    name: /download encrypted chat backup/i,
  });

  await waitFor(() => expect(button).not.toBeDisabled());

  fireEvent.click(button);

  await waitFor(() => {
    expect(mockCreateEncryptedChatBackup).toHaveBeenCalledWith({
      roomId: 'r1',
      currentUserId: 'u1',
      passcodeToUnlockKeys: '123456',
      password: 'abcdef',
      fetchPage,
      fetchPublicKeys,
      includeMedia: true,
    });
  });

  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();

  jest.advanceTimersByTime(1000);

  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

  expect(
    await screen.findByText(/chat backup created and downloaded/i)
  ).toBeInTheDocument();
});

test('shows export error when chat backup fails', async () => {
  mockCreateEncryptedChatBackup.mockRejectedValueOnce(new Error('backup failed'));

  setup();

  fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
    target: { value: '123456' },
  });

  fireEvent.change(exportPasswordInput(), {
    target: { value: 'abcdef' },
  });

  const button = screen.getByRole('button', {
    name: /download encrypted chat backup/i,
  });

  await waitFor(() => expect(button).not.toBeDisabled());

  fireEvent.click(button);

  expect(await screen.findByText(/error: backup failed/i)).toBeInTheDocument();
});

test('restore button is disabled until file and password are valid', () => {
  setup();

  expect(
    screen.getByRole('button', { name: /restore chat backup/i })
  ).toBeDisabled();
});

test('restores encrypted chat backup', async () => {
  mockRestoreEncryptedChatBackup.mockResolvedValueOnce({
    messages: [{ id: 1 }, { id: 2 }],
  });

  setup();

  const file = new File(['{}'], 'backup.json', {
    type: 'application/json',
  });

  attachFile(file);

  fireEvent.change(restorePasswordInput(), {
    target: { value: 'abcdef' },
  });

  const button = screen.getByRole('button', {
    name: /restore chat backup/i,
  });

  await waitFor(() => expect(button).not.toBeDisabled());

  fireEvent.click(button);

  await waitFor(() => {
    expect(mockRestoreEncryptedChatBackup).toHaveBeenCalledWith({
      file,
      password: 'abcdef',
    });
  });

  expect(
    await screen.findByText(/chat backup restored with 2 messages/i)
  ).toBeInTheDocument();
});

test('shows restore error when chat restore fails', async () => {
  mockRestoreEncryptedChatBackup.mockRejectedValueOnce(new Error('restore failed'));

  setup();

  const file = new File(['{}'], 'backup.json', {
    type: 'application/json',
  });

  attachFile(file);

  fireEvent.change(restorePasswordInput(), {
    target: { value: 'abcdef' },
  });

  const button = screen.getByRole('button', {
    name: /restore chat backup/i,
  });

  await waitFor(() => expect(button).not.toBeDisabled());

  fireEvent.click(button);

  expect(await screen.findByText(/error: restore failed/i)).toBeInTheDocument();
});