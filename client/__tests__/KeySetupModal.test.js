/** @jest-environment jsdom */
import { jest } from '@jest/globals';

/* -------- Other mocks -------- */
const mockPost = jest.fn();
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...a) => mockPost(...a) },
}));

const mockSaveKeysLocal = jest.fn();
const mockLoadKeysLocal = jest.fn(async () => null);
const mockGenerateKeypair = jest.fn(() => ({
  publicKey: 'PUB',
  privateKey: 'PRIV',
}));

jest.mock('../src/utils/keys', () => ({
  __esModule: true,
  saveKeysLocal: (...a) => mockSaveKeysLocal(...a),
  loadKeysLocal: (...a) => mockLoadKeysLocal(...a),
  generateKeypair: (...a) => mockGenerateKeypair(...a),
}));

const mockImportEncryptedPrivateKey = jest.fn(async () => 'IMPORTED_PRIV');
jest.mock('../src/utils/keyBackup', () => ({
  __esModule: true,
  importEncryptedPrivateKey: (...a) => mockImportEncryptedPrivateKey(...a),
}));

const mockUploadRemoteKeyBackup = jest.fn(async () => ({}));
const mockRestoreRemoteKeyBackupToLocal = jest.fn(async () => ({}));

jest.mock('../src/utils/keyBackupRemote', () => ({
  __esModule: true,
  uploadRemoteKeyBackup: (...a) => mockUploadRemoteKeyBackup(...a),
  restoreRemoteKeyBackupToLocal: (...a) =>
    mockRestoreRemoteKeyBackupToLocal(...a),
}));

/* -------- Now import test libs and component (AFTER mocks) -------- */
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils';
import KeySetupModal from '../src/components/KeySetupModal.jsx';

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadKeysLocal.mockResolvedValue(null);
});

test('generate new keypair path posts public key', async () => {
  mockPost.mockResolvedValueOnce({ data: {} });

  renderWithRouter(
    <KeySetupModal
      opened
      haveServerPubKey={false}
      onClose={() => {}}
    />
  );

  await userEvent.type(
    screen.getByLabelText(/account password/i),
    'pw'
  );

  await userEvent.click(
    screen.getByRole('button', {
      name: /generate new keypair/i,
    })
  );

  await waitFor(() => expect(mockGenerateKeypair).toHaveBeenCalled());

  expect(mockSaveKeysLocal).toHaveBeenCalledWith({
    publicKey: 'PUB',
    privateKey: 'PRIV',
  });

  expect(mockPost).toHaveBeenCalledWith(
    '/users/keys',
    { publicKey: 'PUB' }
  );

  expect(mockUploadRemoteKeyBackup).toHaveBeenCalledWith({
    publicKey: 'PUB',
    privateKey: 'PRIV',
    password: 'pw',
  });

  expect(
    await screen.findByText(/new keypair generated/i)
  ).toBeInTheDocument();
});

test('import backup path saves private key and shows success', async () => {
  const file = new File(
    [JSON.stringify({ any: 'thing' })],
    'backup.json',
    { type: 'application/json' }
  );

  renderWithRouter(
    <KeySetupModal opened haveServerPubKey onClose={() => {}} />
  );

  const fileInput = screen.getByLabelText(/select backup file/i);
  await userEvent.upload(fileInput, file);

  expect(fileInput.files?.length).toBe(1);
  expect(fileInput.files?.[0]?.name).toBe('backup.json');

  await userEvent.type(
    screen.getByLabelText(/backup password/i),
    'pw'
  );

  await userEvent.click(
    screen.getByRole('button', { name: /^import$/i })
  );

  await waitFor(() =>
    expect(mockImportEncryptedPrivateKey).toHaveBeenCalled()
  );

  expect(mockLoadKeysLocal).toHaveBeenCalled();

  expect(mockSaveKeysLocal).toHaveBeenCalledWith({
    publicKey: null,
    privateKey: 'IMPORTED_PRIV',
  });

  expect(
    await screen.findByText(/private key imported/i)
  ).toBeInTheDocument();
});