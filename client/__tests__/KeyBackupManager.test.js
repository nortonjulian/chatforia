import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import KeyBackupManager from '@/components/KeyBackupManager.jsx';
import '@testing-library/jest-dom';

// Mocks
const mockCreateEncryptedKeyBackup = jest.fn();
const mockAxiosGet = jest.fn();
const mockInstallLocalPrivateKeyBundle = jest.fn();
const mockGetLocalKeyBundleMeta = jest.fn();
const mockSetNeedsKeyUnlock = jest.fn();

jest.mock('@mantine/core', () => {
  const actual = jest.requireActual('@mantine/core');
  const React = require('react');

  function Accordion({ children }) {
    return React.createElement('div', null, children);
  }

  Accordion.Item = ({ children }) =>
    React.createElement('div', null, children);

  Accordion.Control = ({ children }) =>
    React.createElement('button', { type: 'button' }, children);

  Accordion.Panel = ({ children }) =>
    React.createElement('div', null, children);

  return {
    ...actual,
    Accordion,
  };
});

jest.mock('@/utils/backupClient.js', () => ({
  __esModule: true,
  createEncryptedKeyBackup: (...args) =>
    mockCreateEncryptedKeyBackup(...args),
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockAxiosGet(...args),
  },
}));

jest.mock('@/utils/encryptionClient', () => ({
  installLocalPrivateKeyBundle: (...args) =>
    mockInstallLocalPrivateKeyBundle(...args),

  getLocalKeyBundleMeta: (...args) =>
    mockGetLocalKeyBundleMeta(...args),
}));

jest.mock('@/context/UserContext', () => ({
  useUser: () => ({
    currentUser: {
      publicKey: 'test-public-key',
    },
    setNeedsKeyUnlock: mockSetNeedsKeyUnlock,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key, fallback, vars) => {
      if (fallback && vars?.message) {
        return fallback.replace('{{message}}', vars.message);
      }

      return fallback || _key;
    },
  }),
}));

Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      importKey: jest.fn(),
      deriveKey: jest.fn(),
      decrypt: jest.fn(),
    },
  },
  configurable: true,
});

function getExportPasswordInput() {
  return screen.getAllByLabelText(
    /^recovery passcode$/i
  )[0];
}

function getImportPasswordInput() {
  return screen.getAllByLabelText(
    /^recovery passcode$/i
  )[1];
}

function renderManager() {
  return render(
    <MantineProvider>
      <KeyBackupManager />
    </MantineProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();

  mockAxiosGet.mockResolvedValue({
    data: {
      hasBackup: true,
      keys: {
        encryptedPrivateKeyBundle: '{}',
      },
    },
  });

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

  jest
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:url');

  jest
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => {});

  jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('KeyBackupManager', () => {
  test('export button is disabled when inputs are invalid', () => {
    renderManager();

    const button = screen.getByRole('button', {
      name: /create recovery backup/i,
    });

    expect(button).toBeDisabled();
  });

  test('successfully exports backup', async () => {
    mockCreateEncryptedKeyBackup.mockResolvedValueOnce({
      blob: new Blob(['test']),
      filename: 'backup.enc',
    });

    renderManager();

    fireEvent.click(
      screen.getByRole('button', {
        name: /advanced recovery options/i,
      })
    );

    fireEvent.change(
      screen.getByLabelText(/device unlock passcode/i),
      {
        target: {
          value: '123456',
        },
      }
    );

    fireEvent.change(getExportPasswordInput(), {
      target: {
        value: 'abcdefgh',
      },
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /create recovery backup/i,
      })
    );

    await waitFor(() => {
      expect(
        mockCreateEncryptedKeyBackup
      ).toHaveBeenCalledWith({
        unlockPasscode: '123456',
        backupPassword: 'abcdefgh',
      });
    });

    expect(
      screen.getByText(
        /key backup created and downloaded/i
      )
    ).toBeInTheDocument();
  });

  test('shows export error message on failure', async () => {
    mockCreateEncryptedKeyBackup.mockRejectedValueOnce(
      new Error('Export failed')
    );

    renderManager();

    fireEvent.click(
      screen.getByRole('button', {
        name: /advanced recovery options/i,
      })
    );

    fireEvent.change(
      screen.getByLabelText(/device unlock passcode/i),
      {
        target: {
          value: '123456',
        },
      }
    );

    fireEvent.change(getExportPasswordInput(), {
      target: {
        value: 'abcdefgh',
      },
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /create recovery backup/i,
      })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/error: export failed/i)
      ).toBeInTheDocument();
    });
  });

  test('import button is disabled when inputs are invalid', () => {
    renderManager();

    const button = screen.getByRole('button', {
      name: /restore chats/i,
    });

    expect(button).toBeDisabled();
  });

  test('successful import flow', async () => {
    const encryptedPayload = {
      ivB64: btoa('iv'),
      ctB64: btoa('cipher'),
    };

    mockAxiosGet.mockResolvedValue({
      data: {
        hasBackup: true,
        keys: {
          encryptedPrivateKeyBundle:
            JSON.stringify(encryptedPayload),

          publicKey: 'test-public-key',
          privateKeyWrapSalt: btoa('salt'),
          privateKeyWrapIterations: 250000,
          privateKeyWrapKdf: 'PBKDF2',
        },
      },
    });

    global.crypto.subtle.importKey.mockResolvedValue(
      'keyMaterial'
    );

    global.crypto.subtle.deriveKey.mockResolvedValue(
      'derivedKey'
    );

    global.crypto.subtle.decrypt.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          privateKey: 'abc',
        })
      )
    );

    mockGetLocalKeyBundleMeta.mockResolvedValue({
      publicKey: 'test-public-key',
    });

    renderManager();

    fireEvent.change(getImportPasswordInput(), {
      target: {
        value: 'abcdefgh',
      },
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /restore chats/i,
      })
    );

    await waitFor(() => {
      expect(
        mockInstallLocalPrivateKeyBundle
      ).toHaveBeenCalled();

      expect(
        mockSetNeedsKeyUnlock
      ).toHaveBeenCalledWith(false);
    });

    expect(
      screen.getByText(/key backup restored/i)
    ).toBeInTheDocument();
  });

  test('import fails when no backup exists', async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        hasBackup: false,
      },
    });

    renderManager();

    fireEvent.change(getImportPasswordInput(), {
      target: {
        value: 'abcdefgh',
      },
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /restore chats/i,
      })
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          /error: no encrypted backup exists/i
        )
      ).toBeInTheDocument();
    });
  });

  test('import fails when public keys mismatch', async () => {
    mockAxiosGet.mockResolvedValue({
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

    renderManager();

    fireEvent.change(getImportPasswordInput(), {
      target: {
        value: 'abcdefgh',
      },
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: /restore chats/i,
      })
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          /error: server backup does not match/i
        )
      ).toBeInTheDocument();
    });
  });

  test(
    'import fails when install results in wrong key',
    async () => {
      const encryptedPayload = {
        ivB64: btoa('iv'),
        ctB64: btoa('cipher'),
      };

      mockAxiosGet.mockResolvedValue({
        data: {
          hasBackup: true,
          keys: {
            encryptedPrivateKeyBundle:
              JSON.stringify(encryptedPayload),

            publicKey: 'test-public-key',
            privateKeyWrapSalt: btoa('salt'),
            privateKeyWrapIterations: 250000,
            privateKeyWrapKdf: 'PBKDF2',
          },
        },
      });

      global.crypto.subtle.importKey.mockResolvedValue(
        'keyMaterial'
      );

      global.crypto.subtle.deriveKey.mockResolvedValue(
        'derivedKey'
      );

      global.crypto.subtle.decrypt.mockResolvedValue(
        new TextEncoder().encode(
          JSON.stringify({
            privateKey: 'abc',
          })
        )
      );

      mockGetLocalKeyBundleMeta.mockResolvedValue({
        publicKey: 'wrong-key',
      });

      renderManager();

      fireEvent.change(getImportPasswordInput(), {
        target: {
          value: 'abcdefgh',
        },
      });

      fireEvent.click(
        screen.getByRole('button', {
          name: /restore chats/i,
        })
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            /error: key restore incomplete/i
          )
        ).toBeInTheDocument();
      });
    }
  );
});