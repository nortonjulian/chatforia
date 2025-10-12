import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatBackupManager from '@/components/ChatBackupManager'; // <-- update if needed

// ---------- Mocks ----------
// Mantine: light passthroughs with HTML primitives
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Noop = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Button = ({ children, onClick, disabled, loading, ...p }) => (
    <button type="button" disabled={disabled} data-loading={!!loading} onClick={onClick} {...p}>
      {children}
    </button>
  );
  const PasswordInput = ({ label, value, onChange, ...p }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="password"
        value={value}
        onChange={onChange}
        {...p}
      />
    </label>
  );
  const FileInput = ({ label, value, onChange, accept, ...p }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files[0] || null)}
        {...p}
      />
    </label>
  );

  return {
    Button,
    Card: Noop,
    FileInput,
    Group: Noop,
    Stack: Noop,
    Text: ({ children, ...p }) => <p {...p}>{children}</p>,
    PasswordInput,
    Divider: ({ label }) => <div>{label}</div>,
  };
});

// PremiumGuard passthrough
jest.mock('@/components/PremiumGuard.jsx', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

// backupClient methods
const createEncryptedKeyBackup = jest.fn();
const restoreEncryptedKeyBackup = jest.fn();
jest.mock('@/utils/backupClient.js', () => ({
  createEncryptedKeyBackup: (...args) => createEncryptedKeyBackup(...args),
  restoreEncryptedKeyBackup: (...args) => restoreEncryptedKeyBackup(...args),
}));

// URL + <a> click mocks
const createObjectURLSpy = jest.spyOn(URL, 'createObjectURL');
const revokeObjectURLSpy = jest.spyOn(URL, 'revokeObjectURL');

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  createObjectURLSpy.mockReturnValue('blob:mock-url');

  // Mock document.createElement('a') with click
  const a = { click: jest.fn() };
  jest.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'a') return a;
    return document.createElement(tag);
  });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- Helpers ----------
function type(el, val) {
  fireEvent.change(el, { target: { value: val } });
}

describe('ChatBackupManager', () => {
  test('export/import buttons are disabled until inputs are valid', () => {
    render(<ChatBackupManager />);

    const exportBtn = screen.getByRole('button', { name: /download encrypted key backup/i });
    const importBtn = screen.getByRole('button', { name: /restore key backup/i });
    expect(exportBtn).toBeDisabled();
    expect(importBtn).toBeDisabled();

    // Fill export with too-short passwords (<6)
    type(screen.getByLabelText(/unlock passcode/i), '12345');
    type(screen.getByLabelText(/^backup password$/i), '12345');
    expect(exportBtn).toBeDisabled();

    // Now valid
    type(screen.getByLabelText(/unlock passcode/i), '123456');
    type(screen.getByLabelText(/^backup password$/i), 'abcdef');
    expect(exportBtn).not.toBeDisabled();

    // Import needs file + 2 passwords (>=6)
    // file first
    const fileInput = screen.getByLabelText(/backup file/i);
    const file = new File([JSON.stringify({})], 'backup.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    // too short passwords
    type(screen.getByLabelText(/^backup password$/i), '12345'); // import side shares same label; last rendered wins in our mock
    type(screen.getByLabelText(/new local passcode/i), '12345');
    expect(importBtn).toBeDisabled();

    // now valid lengths
    type(screen.getByLabelText(/^backup password$/i), 'qwerty1');
    type(screen.getByLabelText(/new local passcode/i), 'secret1');
    expect(importBtn).not.toBeDisabled();
  });

  test('successful export triggers download, shows success, and revokes URL', async () => {
    createEncryptedKeyBackup.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'chatforia-keys.json',
    });

    render(<ChatBackupManager />);

    type(screen.getByLabelText(/unlock passcode/i), 'unlock-123');
    type(screen.getByLabelText(/^backup password$/i), 'backup-123');

    const exportBtn = screen.getByRole('button', { name: /download encrypted key backup/i });
    expect(exportBtn).not.toBeDisabled();

    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(createEncryptedKeyBackup).toHaveBeenCalledWith({
        unlockPasscode: 'unlock-123',
        backupPassword: 'backup-123',
      });
    });

    // Download link created & clicked
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const anchor = document.createElement.mock.results[0].value;
    expect(anchor.download).toBe('chatforia-keys.json');
    expect(anchor.click).toHaveBeenCalled();

    // Success message
    expect(await screen.findByText(/key backup created and downloaded/i)).toBeInTheDocument();

    // Revoke after timer
    jest.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  test('failed export shows error message', async () => {
    createEncryptedKeyBackup.mockRejectedValue(new Error('Export Boom'));
    render(<ChatBackupManager />);

    type(screen.getByLabelText(/unlock passcode/i), 'unlock-123');
    type(screen.getByLabelText(/^backup password$/i), 'backup-123');

    fireEvent.click(screen.getByRole('button', { name: /download encrypted key backup/i }));

    expect(await screen.findByText(/error: export boom/i)).toBeInTheDocument();
  });

  test('successful import shows success message', async () => {
    restoreEncryptedKeyBackup.mockResolvedValue();

    render(<ChatBackupManager />);

    const file = new File([JSON.stringify({})], 'backup.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/backup file/i), { target: { files: [file] } });
    type(screen.getByLabelText(/^backup password$/i), 'import-999');
    type(screen.getByLabelText(/new local passcode/i), 'local-999');

    const importBtn = screen.getByRole('button', { name: /restore key backup/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(restoreEncryptedKeyBackup).toHaveBeenCalledWith({
        file,
        backupPassword: 'import-999',
        setLocalPasscode: 'local-999',
      });
    });

    expect(await screen.findByText(/key backup restored/i)).toBeInTheDocument();
  });

  test('failed import shows error message', async () => {
    restoreEncryptedKeyBackup.mockRejectedValue(new Error('Import Boom'));

    render(<ChatBackupManager />);

    const file = new File([JSON.stringify({})], 'backup.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/backup file/i), { target: { files: [file] } });
    type(screen.getByLabelText(/^backup password$/i), 'import-999');
    type(screen.getByLabelText(/new local passcode/i), 'local-999');

    fireEvent.click(screen.getByRole('button', { name: /restore key backup/i }));

    expect(await screen.findByText(/error: import boom/i)).toBeInTheDocument();
  });
});
