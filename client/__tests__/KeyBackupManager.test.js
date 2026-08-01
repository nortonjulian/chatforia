import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

jest.mock('@mantine/core', () => {
  const React = require('react');
  const Wrapper = ({ children }) => <div>{children}</div>;

  const Accordion = ({ children }) => <div>{children}</div>;
  Accordion.Item = Wrapper;
  Accordion.Control = ({ children }) => <button type="button">{children}</button>;
  Accordion.Panel = Wrapper;

  const PasswordInput = ({ label, value, onChange, disabled }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="password"
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  );

  const Button = ({ children, onClick, disabled, loading }) => (
    <button type="button" onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  );

  return {
    __esModule: true,
    MantineProvider: Wrapper,
    Accordion,
    Alert: ({ children, title }) => <div role="alert" aria-label={title}>{children}</div>,
    Button,
    Card: Wrapper,
    Divider: ({ label }) => <div role="separator">{label}</div>,
    Group: Wrapper,
    PasswordInput,
    Stack: Wrapper,
    Text: Wrapper,
  };
});

const mockGetLocalKeyBundleMeta = jest.fn();
const mockGetUnlockedPrivateKey = jest.fn();
const mockFetchRemoteKeyBackup = jest.fn();
const mockRestoreRemoteKeyBackup = jest.fn();
const mockUploadRemoteKeyBackup = jest.fn();
const mockCreateEncryptedKeyBackup = jest.fn();
const mockSetNeedsKeyUnlock = jest.fn();
const mockSetKeyMeta = jest.fn();
const mockRefreshSession = jest.fn();

jest.mock('@/utils/encryptionClient', () => ({
  getLocalKeyBundleMeta: (...args) => mockGetLocalKeyBundleMeta(...args),
  getUnlockedPrivateKeyForPublicKey: (...args) => mockGetUnlockedPrivateKey(...args),
}));

jest.mock('@/utils/keyBackupRemote', () => ({
  fetchRemoteKeyBackup: (...args) => mockFetchRemoteKeyBackup(...args),
  restoreRemoteKeyBackupToLocal: (...args) => mockRestoreRemoteKeyBackup(...args),
  uploadRemoteKeyBackup: (...args) => mockUploadRemoteKeyBackup(...args),
}));

jest.mock('@/utils/backupClient.js', () => ({
  createEncryptedKeyBackup: (...args) => mockCreateEncryptedKeyBackup(...args),
}));

jest.mock('@/context/UserContext', () => ({
  useUser: () => ({
    currentUser: { publicKey: 'test-public-key' },
    setNeedsKeyUnlock: mockSetNeedsKeyUnlock,
    setKeyMeta: mockSetKeyMeta,
    refreshSession: mockRefreshSession,
  }),
}));

import KeyBackupManager from '@/components/KeyBackupManager.jsx';

function renderManager() {
  return render(
    <MantineProvider>
      <KeyBackupManager />
    </MantineProvider>
  );
}

async function waitForStatus() {
  await screen.findByText(/Protected on this browser/i);
}

describe('KeyBackupManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLocalKeyBundleMeta.mockResolvedValue({ publicKey: 'test-public-key' });
    mockGetUnlockedPrivateKey.mockResolvedValue('private-key');
    mockFetchRemoteKeyBackup.mockResolvedValue({
      encryptedPrivateKeyBundle: 'encrypted',
      publicKey: 'test-public-key',
    });
    mockRestoreRemoteKeyBackup.mockResolvedValue(undefined);
    mockUploadRemoteKeyBackup.mockResolvedValue(undefined);
    mockRefreshSession.mockResolvedValue(undefined);
  });

  test('loads and displays the current secure-message recovery status', async () => {
    renderManager();
    expect(screen.getByText(/Checking secure message status/i)).toBeInTheDocument();
    await waitForStatus();
    expect(screen.getByText(/Recovery backup saved/i)).toBeInTheDocument();
  });

  test('requires valid matching passcodes before updating the account backup', async () => {
    renderManager();
    await waitForStatus();

    const passcodes = screen.getAllByLabelText(/^Secure Messages Passcode$/i);
    const confirm = screen.getByLabelText(/^Confirm Secure Messages Passcode$/i);
    const button = screen.getByRole('button', { name: /Update Secure Message Backup/i });

    expect(button).toBeDisabled();
    fireEvent.change(passcodes[0], { target: { value: 'abcdefgh' } });
    fireEvent.change(confirm, { target: { value: 'abcdefgh' } });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => {
      expect(mockUploadRemoteKeyBackup).toHaveBeenCalledWith({
        publicKey: 'test-public-key',
        privateKey: 'private-key',
        password: 'abcdefgh',
      });
    });
    expect(await screen.findByText(/updated successfully/i)).toBeInTheDocument();
  });

  test('restores and verifies the account key', async () => {
    renderManager();
    await waitForStatus();

    const restoreInput = screen.getAllByLabelText(/^Secure Messages Passcode$/i)[1];
    fireEvent.change(restoreInput, { target: { value: 'abcdefgh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore Secure Messages' }));

    await waitFor(() => {
      expect(mockRestoreRemoteKeyBackup).toHaveBeenCalledWith({ password: 'abcdefgh' });
      expect(mockSetKeyMeta).toHaveBeenCalledWith({ publicKey: 'test-public-key' });
      expect(mockSetNeedsKeyUnlock).toHaveBeenCalledWith(false);
    });
    expect(mockRefreshSession).toHaveBeenCalled();
    expect(await screen.findByText(/restored on this browser/i)).toBeInTheDocument();
  });

  test('shows a restore error from the recovery service', async () => {
    mockRestoreRemoteKeyBackup.mockRejectedValueOnce(new Error('Wrong passcode'));
    renderManager();
    await waitForStatus();

    fireEvent.change(screen.getAllByLabelText(/^Secure Messages Passcode$/i)[1], {
      target: { value: 'abcdefgh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore Secure Messages' }));

    expect(await screen.findByText('Error: Wrong passcode')).toBeInTheDocument();
  });

  test('downloads a separately encrypted key file', async () => {
    mockCreateEncryptedKeyBackup.mockResolvedValue({
      blob: new Blob(['backup']),
      filename: 'chatforia-key.enc',
    });
    URL.createObjectURL = jest.fn(() => 'blob:test');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderManager();
    await waitForStatus();
    fireEvent.click(screen.getByRole('button', {
      name: /Advanced: Download an encrypted key file/i,
    }));
    fireEvent.change(screen.getByLabelText(/^Backup-file password$/i), {
      target: { value: 'abcdefgh' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm backup-file password$/i), {
      target: { value: 'abcdefgh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download Encrypted Key File' }));

    await waitFor(() => expect(mockCreateEncryptedKeyBackup).toHaveBeenCalled());
    expect(await screen.findByText(/Encrypted backup file downloaded/i)).toBeInTheDocument();
  });
});
