import { jest } from '@jest/globals';

const mockPost = jest.fn();

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
  },
}));

const mockSaveKeysLocal = jest.fn();
const mockLoadKeysLocal = jest.fn();
const mockGenerateKeypair = jest.fn(() => ({
  publicKey: 'PUB',
  privateKey: 'PRIV',
}));

jest.mock('../src/utils/keys', () => ({
  __esModule: true,
  saveKeysLocal: (...args) =>
    mockSaveKeysLocal(...args),
  loadKeysLocal: (...args) =>
    mockLoadKeysLocal(...args),
  generateKeypair: (...args) =>
    mockGenerateKeypair(...args),
}));

const mockImportEncryptedPrivateKey = jest.fn();

jest.mock('../src/utils/keyBackup', () => ({
  __esModule: true,
  importEncryptedPrivateKey: (...args) =>
    mockImportEncryptedPrivateKey(...args),
}));

const mockUploadRemoteKeyBackup = jest.fn();
const mockRestoreRemoteKeyBackupToLocal = jest.fn();

jest.mock('../src/utils/keyBackupRemote', () => ({
  __esModule: true,
  uploadRemoteKeyBackup: (...args) =>
    mockUploadRemoteKeyBackup(...args),

  restoreRemoteKeyBackupToLocal: (...args) =>
    mockRestoreRemoteKeyBackupToLocal(...args),
}));

import userEvent from '@testing-library/user-event';
import {
  screen,
  waitFor,
} from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils';
import KeySetupModal from '../src/components/KeySetupModal.jsx';

beforeEach(() => {
  jest.clearAllMocks();

  mockLoadKeysLocal.mockResolvedValue(null);
  mockImportEncryptedPrivateKey.mockResolvedValue(
    'IMPORTED_PRIV'
  );
  mockUploadRemoteKeyBackup.mockResolvedValue({});
  mockRestoreRemoteKeyBackupToLocal.mockResolvedValue({});
});

test('sets up encryption and posts the public key', async () => {
  const user = userEvent.setup();

  mockPost.mockResolvedValueOnce({
    data: {},
  });

  renderWithRouter(
    <KeySetupModal
      opened
      haveServerPubKey={false}
      onClose={() => {}}
    />
  );

  await user.type(
    screen.getByLabelText(
      /^recovery passcode$/i
    ),
    'abcdefgh'
  );

  await user.type(
    screen.getByLabelText(
      /^confirm recovery passcode$/i
    ),
    'abcdefgh'
  );

  await user.click(
    screen.getByRole('button', {
      name: /set up encryption/i,
    })
  );

  await waitFor(() => {
    expect(
      mockGenerateKeypair
    ).toHaveBeenCalled();
  });

  expect(mockSaveKeysLocal).toHaveBeenCalledWith({
    publicKey: 'PUB',
    privateKey: 'PRIV',
  });

  expect(mockPost).toHaveBeenCalledWith(
    '/users/keys',
    {
      publicKey: 'PUB',
    }
  );

  expect(
    mockUploadRemoteKeyBackup
  ).toHaveBeenCalledWith({
    publicKey: 'PUB',
    privateKey: 'PRIV',
    password: 'abcdefgh',
  });

  expect(
    await screen.findByText(/encryption is ready/i)
  ).toBeInTheDocument();
});

test('imports backup file, saves private key, and shows success', async () => {
  const user = userEvent.setup();

  const file = new File(
    [JSON.stringify({ any: 'thing' })],
    'backup.json',
    {
      type: 'application/json',
    }
  );

  renderWithRouter(
    <KeySetupModal
      opened
      haveServerPubKey
      onClose={() => {}}
    />
  );

  await user.click(
    screen.getByRole('button', {
      name: /show advanced recovery/i,
    })
  );

  const fileInput = screen.getByLabelText(
    /select backup file/i
  );

  await user.upload(fileInput, file);

  expect(fileInput.files).toHaveLength(1);
  expect(fileInput.files[0].name).toBe(
    'backup.json'
  );

  await user.type(
    screen.getByLabelText(
      /^backup file password$/i
    ),
    'pw'
  );

  await user.click(
    screen.getByRole('button', {
      name: /import backup file/i,
    })
  );

  await waitFor(() => {
    expect(
      mockImportEncryptedPrivateKey
    ).toHaveBeenCalledWith(file, 'pw');
  });

  expect(mockLoadKeysLocal).toHaveBeenCalled();

  expect(mockSaveKeysLocal).toHaveBeenCalledWith({
    publicKey: null,
    privateKey: 'IMPORTED_PRIV',
  });

  expect(
    await screen.findByText(
      /private key imported to this device/i
    )
  ).toBeInTheDocument();
});