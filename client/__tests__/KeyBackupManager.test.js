import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import KeyBackupManager from './KeyBackupManager';
import '@testing-library/jest-dom';

// Mocks
const mockCreateEncryptedKeyBackup = jest.fn();
const mockAxiosGet = jest.fn();
const mockInstallLocalPrivateKeyBundle = jest.fn();
const mockGetLocalKeyBundleMeta = jest.fn();
const mockSetNeedsKeyUnlock = jest.fn();

jest.mock('../utils/backupClient.js', () => ({
  createEncryptedKeyBackup: (...args) => mockCreateEncryptedKeyBackup(...args),
}));

jest.mock('@/api/axiosClient', () => ({
  get: (...args) => mockAxiosGet(...args),
}));

jest.mock('@/utils/encryptionClient', () => ({
  installLocalPrivateKeyBundle: (...args) =>
    mockInstallLocalPrivateKeyBundle(...args),
  getLocalKeyBundleMeta: (...args) => mockGetLocalKeyBundleMeta(...args),
}));

jest.mock('@/context/UserContext', () => ({
  useUser: () => ({
    currentUser: { publicKey: 'test-public-key' },
    setNeedsKeyUnlock: mockSetNeedsKeyUnlock,
  }),
}));

// Mock browser APIs
global.URL.createObjectURL = jest.fn(() => 'blob:url');
global.URL.revokeObjectURL = jest.fn();
document.createElement = jest.fn(() => ({
  click: jest.fn(),
}));

// Mock crypto
global.crypto = {
  subtle: {
    importKey: jest.fn(),
    deriveKey: jest.fn(),
    decrypt: jest.fn(),
  },
};

describe('KeyBackupManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('export button is disabled when inputs are invalid', () => {
    render(<KeyBackupManager />);

    const button = screen.getByRole('button', {
      name: /download encrypted key backup/i,
    });

    expect(button).toBeDisabled();
  });

  test('successfully exports backup', async () => {
    mockCreateEncryptedKeyBackup.mockResolvedValueOnce({
      blob: new Blob(['test']),
      filename: 'backup.enc',
    });

    render(<KeyBackupManager />);

    fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
      target: { value: '123456' },
    });

    fireEvent.change(screen.getByLabelText(/^backup password$/i), {
      target: { value: 'abcdef' },
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /download encrypted key backup/i,
      })
    );

    await waitFor(() => {
      expect(mockCreateEncryptedKeyBackup).toHaveBeenCalled();
    });

    expect(
      screen.getByText(/key backup created and downloaded/i)
    ).toBeInTheDocument();
  });

  test('shows export error message on failure', async () => {
    mockCreateEncryptedKeyBackup.mockRejectedValueOnce(
      new Error('Export failed')
    );

    render(<KeyBackupManager />);

    fireEvent.change(screen.getByLabelText(/unlock passcode/i), {
      target: { value: '123456' },
    });

    fireEvent.change(screen.getByLabelText(/^backup password$/i), {
      target: { value: 'abcdef' },
    });

    fireEvent.click(screen.getByText(/download encrypted key backup/i));

    await waitFor(() => {
      expect(screen.getByText(/error: export failed/i)).toBeInTheDocument();
    });
  });

  test('import button is disabled when inputs are invalid', () => {
    render(<KeyBackupManager />);

    const button = screen.getByRole('button', {
      name: /restore from account backup/i,
    });

    expect(button).toBeDisabled();
  });

  test('successful import flow', async () => {
    const encryptedPayload = {
      ivB64: btoa('iv'),
      ctB64: btoa('cipher'),
    };

    mockAxiosGet.mockResolvedValueOnce({
      data: {
        hasBackup: true,
        keys: {
          encryptedPrivateKeyBundle: JSON.stringify(encryptedPayload),
          publicKey: 'test-public-key',
          privateKeyWrapSalt: btoa('salt'),
          privateKeyWrapIterations: 250000,
          privateKeyWrapKdf: 'PBKDF2',
        },
      },
    });

    global.crypto.subtle.importKey.mockResolvedValue('keyMaterial');
    global.crypto.subtle.deriveKey.mockResolvedValue('derivedKey');
    global.crypto.subtle.decrypt.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ privateKey: 'abc' }))
    );

    mockGetLocalKeyBundleMeta.mockResolvedValue({
      publicKey: 'test-public-key',
    });

    render(<KeyBackupManager />);

    fireEvent.change(screen.getByLabelText(/^backup password$/i), {
      target: { value: 'abcdef' },
    });

    fireEvent.change(screen.getByLabelText(/new local passcode/i), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByText(/restore from account backup/i));

    await waitFor(() => {
      expect(mockInstallLocalPrivateKeyBundle).toHaveBeenCalled();
      expect(mockSetNeedsKeyUnlock).toHaveBeenCalledWith(false);
    });

    expect(
      screen.getByText(/key backup restored/i)
    ).toBeInTheDocument();
  });

  test('import fails when no backup exists', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: { hasBackup: false },
    });

    render(<KeyBackupManager />);

    fireEvent.change(screen.getByLabelText(/^backup password$/i), {
      target: { value: 'abcdef' },
    });

    fireEvent.change(screen.getByLabelText(/new local passcode/i), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByText(/restore from account backup/i));

    await waitFor(() => {
      expect(
        screen.getByText(/error: no encrypted backup exists/i)
      ).toBeInTheDocument();
    });
  });

  test('import fails when public keys mismatch', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        hasBackup: true,
        keys: {
          encryptedPrivateKeyBundle: '{}',
          publicKey: 'wrong-key',
          privateKeyWrapSalt: btoa('salt'),
          privateKeyWrapIterations: 250000,
          privateKeyWrapKdf: 'PBKDF2',
        },
      },
    });

    render(<KeyBackupManager />);

    fireEvent.change(screen.getByLabelText(/^backup password$/i), {
      target: { value: 'abcdef' },
    });

    fireEvent.change(screen.getByLabelText(/new local passcode/i), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByText(/restore from account backup/i));

    await waitFor(() => {
      expect(
        screen.getByText(/error: server backup does not match/i)
      ).toBeInTheDocument();
    });
  });

  test('import fails when install results in wrong key', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        hasBackup: true,
        keys: {
          encryptedPrivateKeyBundle: '{}',
          publicKey: 'test-public-key',
          privateKeyWrapSalt: btoa('salt'),
          privateKeyWrapIterations: 250000,
          privateKeyWrapKdf: 'PBKDF2',
        },
      },
    });

    global.crypto.subtle.importKey.mockResolvedValue('keyMaterial');
    global.crypto.subtle.deriveKey.mockResolvedValue('derivedKey');
    global.crypto.subtle.decrypt.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ privateKey: 'abc' }))
    );

    mockGetLocalKeyBundleMeta.mockResolvedValue({
      publicKey: 'wrong-key',
    });

    render(<KeyBackupManager />);

    fireEvent.change(screen.getByLabelText(/^backup password$/i), {
      target: { value: 'abcdef' },
    });

    fireEvent.change(screen.getByLabelText(/new local passcode/i), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByText(/restore from account backup/i));

    await waitFor(() => {
      expect(
        screen.getByText(/error: key restore incomplete/i)
      ).toBeInTheDocument();
    });
  });
});