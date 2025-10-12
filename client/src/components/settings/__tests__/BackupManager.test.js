import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatBackupManager from '@/components/BackupManager'; // adjust path if needed

// ---- Mocks for backupClient ----
const createEncryptedKeyBackup = jest.fn();
const restoreEncryptedKeyBackup = jest.fn();
const createEncryptedChatBackup = jest.fn();
const restoreEncryptedChatBackup = jest.fn();

jest.mock('@/utils/backupClient.js', () => ({
  __esModule: true,
  createEncryptedKeyBackup: (...args) => createEncryptedKeyBackup(...args),
  restoreEncryptedKeyBackup: (...args) => restoreEncryptedKeyBackup(...args),
  createEncryptedChatBackup: (...args) => createEncryptedChatBackup(...args),
  restoreEncryptedChatBackup: (...args) => restoreEncryptedChatBackup(...args),
}));

// ---- URL & <a> download plumbing ----
const createObjectURLMock = jest.fn(() => 'blob:mock-url');
const revokeObjectURLMock = jest.fn();
global.URL.createObjectURL = createObjectURLMock;
global.URL.revokeObjectURL = revokeObjectURLMock;

let anchorClickMock;
beforeEach(() => {
  jest.clearAllMocks();
  anchorClickMock = jest.fn();
  // Only intercept anchor creation; everything else can be native
  jest.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'a') {
      return { set href(v) {}, get href() { return ''; }, set download(v) {}, click: anchorClickMock };
    }
    // fallback minimal element
    return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- Helpers ----
function type(el, value) {
  fireEvent.change(el, { target: { value } });
}

function setFile(input, name = 'backup.json') {
  const file = new File([JSON.stringify({})], name, { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

function setup(props = {}) {
  const fetchPage = jest.fn(async () => ({ messages: [], nextCursor: null }));
  const fetchPublicKeys = jest.fn(async () => ({}));
  const utils = render(
    <ChatBackupManager
      currentUserId="u1"
      roomId="r1"
      fetchPage={fetchPage}
      fetchPublicKeys={fetchPublicKeys}
      {...props}
    />
  );
  return { ...utils, fetchPage, fetchPublicKeys };
}

describe('BackupManager / ChatBackupManager', () => {
  test('restore buttons are disabled until a file is selected', () => {
    setup();
    expect(screen.getByRole('button', { name: /restore keys/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /restore chat/i })).toBeDisabled();

    const fileInput = screen.getByLabelText(/file/i) || screen.getByRole('textbox', { hidden: true }); // fallback
    const fileEl = screen.getByRole('textbox', { hidden: false }) || screen.getByRole('button'); // ensure query doesn't fail

    // More reliable: query by input[type="file"]
    const fileElInput = document.querySelector('input[type="file"]');
    setFile(fileElInput);

    expect(screen.getByRole('button', { name: /restore keys/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /restore chat/i })).not.toBeDisabled();
  });

  test('key backup: success triggers download & status', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    createEncryptedKeyBackup.mockResolvedValueOnce({ blob, filename: 'keys-2025.json' });

    setup();

    // Fill passcodes
    type(screen.getByLabelText(/local passcode/i), 'local-123');
    type(screen.getByLabelText(/backup password/i), 'pw-456');

    fireEvent.click(screen.getByRole('button', { name: /backup keys/i }));

    await waitFor(() => {
      expect(createEncryptedKeyBackup).toHaveBeenCalledWith({
        unlockPasscode: 'local-123',
        backupPassword: 'pw-456',
      });
    });

    // Download happened
    expect(createObjectURLMock).toHaveBeenCalledWith(blob);
    expect(anchorClickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');

    // Status message
    expect(screen.getByText(/Key backup saved as keys-2025\.json/i)).toBeInTheDocument();
  });

  test('key backup: failure surfaces error', async () => {
    createEncryptedKeyBackup.mockRejectedValueOnce(new Error('nope'));
    setup();

    fireEvent.click(screen.getByRole('button', { name: /backup keys/i }));

    expect(await screen.findByText(/Key backup failed: nope/i)).toBeInTheDocument();
  });

  test('key restore: success and failure status updates', async () => {
    const { } = setup();

    // Select file + enter passwords
    const fileEl = document.querySelector('input[type="file"]');
    const file = setFile(fileEl, 'keys.json');
    type(screen.getByLabelText(/backup password/i), 'pw');
    type(screen.getByLabelText(/local passcode/i), 'local');

    // Success
    restoreEncryptedKeyBackup.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: /restore keys/i }));
    expect(await screen.findByText(/Key backup restored!/i)).toBeInTheDocument();

    // Failure
    restoreEncryptedKeyBackup.mockRejectedValueOnce(new Error('bad key file'));
    fireEvent.click(screen.getByRole('button', { name: /restore keys/i }));
    expect(await screen.findByText(/Key restore failed: bad key file/i)).toBeInTheDocument();

    // Call shape
    expect(restoreEncryptedKeyBackup).toHaveBeenCalledWith({
      file: expect.any(File),
      backupPassword: 'pw',
      setLocalPasscode: 'local',
    });
  });

  test('chat backup: success triggers download & passes through options', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    createEncryptedChatBackup.mockResolvedValueOnce({ blob, filename: 'chat-r1-u1.json' });

    const { fetchPage, fetchPublicKeys } = setup();

    type(screen.getByLabelText(/local passcode/i), 'unlock-me');
    type(screen.getByLabelText(/backup password/i), 'chat-pw');

    fireEvent.click(screen.getByRole('button', { name: /backup chat/i }));

    await waitFor(() => {
      expect(createEncryptedChatBackup).toHaveBeenCalledWith({
        roomId: 'r1',
        currentUserId: 'u1',
        passcodeToUnlockKeys: 'unlock-me',
        password: 'chat-pw',
        fetchPage,
        fetchPublicKeys,
        includeMedia: true,
      });
    });

    expect(createObjectURLMock).toHaveBeenCalledWith(blob);
    expect(anchorClickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalled();

    expect(screen.getByText(/Chat backup saved as chat-r1-u1\.json/i)).toBeInTheDocument();
  });

  test('chat backup: failure surfaces error', async () => {
    createEncryptedChatBackup.mockRejectedValueOnce(new Error('chat nope'));
    setup();

    fireEvent.click(screen.getByRole('button', { name: /backup chat/i }));
    expect(await screen.findByText(/Chat backup failed: chat nope/i)).toBeInTheDocument();
  });

  test('chat restore: success shows message count; failure shows error', async () => {
    setup();

    // Add file + password
    const input = document.querySelector('input[type="file"]');
    setFile(input, 'chat.json');
    type(screen.getByLabelText(/backup password/i), 'pw');

    // Success
    restoreEncryptedChatBackup.mockResolvedValueOnce({ messages: [{}, {}, {}] });
    fireEvent.click(screen.getByRole('button', { name: /restore chat/i }));
    expect(await screen.findByText(/Chat backup restored with 3 messages/i)).toBeInTheDocument();

    // Failure
    restoreEncryptedChatBackup.mockRejectedValueOnce(new Error('bad chat file'));
    fireEvent.click(screen.getByRole('button', { name: /restore chat/i }));
    expect(await screen.findByText(/Chat restore failed: bad chat file/i)).toBeInTheDocument();

    // Call shape
    expect(restoreEncryptedChatBackup).toHaveBeenCalledWith({
      file: expect.any(File),
      password: 'pw',
    });
  });
});
