import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatBackupManager from '@/components/ChatBackupManager';

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
  const FileInput = ({ label, value, onChange, accept, placeholder, ...p }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="file"
        accept={accept}
        placeholder={placeholder}
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

// backupClient methods — prefix with "mock" so they can be used inside jest.mock()
const mockCreateEncryptedKeyBackup = jest.fn();
const mockRestoreEncryptedKeyBackup = jest.fn();
jest.mock('@/utils/backupClient.js', () => ({
  __esModule: true,
  createEncryptedKeyBackup: (...args) => mockCreateEncryptedKeyBackup(...args),
  restoreEncryptedKeyBackup: (...args) => mockRestoreEncryptedKeyBackup(...args),
}));

// We'll provide our own anchor element so we can inspect it
let realCreateElement;
let anchorEl;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  // Polyfill URL methods if missing; then stub them
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => '', writable: true });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
  }
  URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
  URL.revokeObjectURL = jest.fn();

  // Save real createElement, then return a shared <a> we can inspect
  realCreateElement = document.createElement.bind(document);
  anchorEl = realCreateElement('a');
  jest.spyOn(anchorEl, 'click').mockImplementation(() => {});
  jest.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'a') return anchorEl;
    return realCreateElement(tag);
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
const exportUnlockInput = () => screen.getByLabelText(/unlock passcode/i);
const exportBackupPwdInput = () => screen.getAllByLabelText(/^backup password$/i)[0];
const importFileInput = () => screen.getByLabelText(/backup file/i);
const importBackupPwdInput = () => screen.getAllByLabelText(/^backup password$/i)[1];
const importNewLocalPasscodeInput = () => screen.getByLabelText(/new local passcode/i);

describe('ChatBackupManager', () => {
  test('export/import buttons are disabled until inputs are valid', () => {
    render(<ChatBackupManager />);

    const exportBtn = screen.getByRole('button', { name: /download encrypted key backup/i });
    const importBtn = screen.getByRole('button', { name: /restore key backup/i });
    expect(exportBtn).toBeDisabled();
    expect(importBtn).toBeDisabled();

    // Fill export with too-short passwords (<6)
    type(exportUnlockInput(), '12345');
    type(exportBackupPwdInput(), '12345');
    expect(exportBtn).toBeDisabled();

    // Now valid
    type(exportUnlockInput(), '123456');
    type(exportBackupPwdInput(), 'abcdef');
    expect(exportBtn).not.toBeDisabled();

    // Import needs file + 2 passwords (>=6)
    const file = new File([JSON.stringify({})], 'backup.json', { type: 'application/json' });
    fireEvent.change(importFileInput(), { target: { files: [file] } });

    // too short passwords
    type(importBackupPwdInput(), '12345'); // import side "Backup password"
    type(importNewLocalPasscodeInput(), '12345');
    expect(importBtn).toBeDisabled();

    // now valid
    type(importBackupPwdInput(), 'qwerty1');
    type(importNewLocalPasscodeInput(), 'secret1');
    expect(importBtn).not.toBeDisabled();
  });

  test('successful export triggers download, shows success, and revokes URL', async () => {
    mockCreateEncryptedKeyBackup.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'chatforia-keys.json',
    });

    render(<ChatBackupManager />);

    type(exportUnlockInput(), 'unlock-123');
    type(exportBackupPwdInput(), 'backup-123');

    const exportBtn = screen.getByRole('button', { name: /download encrypted key backup/i });
    expect(exportBtn).not.toBeDisabled();

    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(mockCreateEncryptedKeyBackup).toHaveBeenCalledWith({
        unlockPasscode: 'unlock-123',
        backupPassword: 'backup-123',
      });
    });

    // Download link created & clicked
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorEl.download).toBe('chatforia-keys.json');
    expect(anchorEl.click).toHaveBeenCalled();

    // Success message
    expect(await screen.findByText(/key backup created and downloaded/i)).toBeInTheDocument();

    // Revoke after timer
    jest.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  test('failed export shows error message', async () => {
    mockCreateEncryptedKeyBackup.mockRejectedValue(new Error('Export Boom'));
    render(<ChatBackupManager />);

    type(exportUnlockInput(), 'unlock-123');
    type(exportBackupPwdInput(), 'backup-123');

    fireEvent.click(screen.getByRole('button', { name: /download encrypted key backup/i }));

    expect(await screen.findByText(/error: export boom/i)).toBeInTheDocument();
  });

  test('successful import shows success message', async () => {
    mockRestoreEncryptedKeyBackup.mockResolvedValue();

    render(<ChatBackupManager />);

    const file = new File([JSON.stringify({})], 'backup.json', { type: 'application/json' });
    fireEvent.change(importFileInput(), { target: { files: [file] } });
    type(importBackupPwdInput(), 'import-999');
    type(importNewLocalPasscodeInput(), 'local-999');

    const importBtn = screen.getByRole('button', { name: /restore key backup/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockRestoreEncryptedKeyBackup).toHaveBeenCalledWith({
        file,
        backupPassword: 'import-999',
        setLocalPasscode: 'local-999',
      });
    });

    expect(await screen.findByText(/key backup restored/i)).toBeInTheDocument();
  });

  test('failed import shows error message', async () => {
    mockRestoreEncryptedKeyBackup.mockRejectedValue(new Error('Import Boom'));

    render(<ChatBackupManager />);

    const file = new File([JSON.stringify({})], 'backup.json', { type: 'application/json' });
    fireEvent.change(importFileInput(), { target: { files: [file] } });
    type(importBackupPwdInput(), 'import-999');
    type(importNewLocalPasscodeInput(), 'local-999');

    fireEvent.click(screen.getByRole('button', { name: /restore key backup/i }));

    expect(await screen.findByText(/error: import boom/i)).toBeInTheDocument();
  });
});
