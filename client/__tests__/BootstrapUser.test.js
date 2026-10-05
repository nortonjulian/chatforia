/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';

// Keep the axios client lean and spy-able
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('../src/utils/keys', () => ({
  __esModule: true,
  generateKeypair: jest.fn(),
  loadKeysLocal: jest.fn(),
  saveKeysLocal: jest.fn(),
}));

jest.mock('../src/utils/keyStore', () => ({
  __esModule: true,
  migrateLocalToIDBIfNeeded: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/keyBackupRemote', () => ({
  __esModule: true,
  fetchRemoteKeyBackup: jest.fn(() => Promise.resolve(null)),
}));

// Mock user context hook EXACTLY as the component imports it
const mockCtx = { currentUser: null, setCurrentUser: jest.fn() };
jest.mock('../src/context/UserContext', () => ({
  __esModule: true,
  useUser: () => mockCtx,
}));

// Icons → noop svg
jest.mock('@tabler/icons-react', () => {
  const React = require('react');
  return new Proxy({}, { get: () => (props) => React.createElement('svg', props) });
});

// IMPORTANT: mock KeySetupModal so tests can query by test id
jest.mock('../src/components/KeySetupModal.jsx', () => ({
  __esModule: true,
  default: ({ opened, haveServerPubKey }) => (
    <div data-testid="key-modal" data-opened={String(!!opened)} data-server={String(!!haveServerPubKey)} />
  ),
}));

// ---- After mocks, import the SUT and helpers
import axiosClient from '../src/api/axiosClient';
import { loadKeysLocal, generateKeypair, saveKeysLocal } from '../src/utils/keys';
import BootstrapUser from '../src/components/BootstrapUser.jsx';

const mockFetchJson = (data, ok = true) =>
  jest.fn().mockResolvedValue({ ok, json: async () => data });

/**
 * setCurrentUser spy that records the *resolved object* even when the SUT
 * calls it with an updater function (prev => next). This makes assertions like
 * toHaveBeenCalledWith(expect.objectContaining({ publicKey: 'PUB' })) pass.
 */
function makeSetCurrentUserSpy() {
  const spy = jest.fn((arg) => {
    if (typeof arg === 'function') {
      const next = arg(mockCtx.currentUser);
      // Overwrite the just-recorded call (which currently has the function arg)
      const i = spy.mock.calls.length - 1;
      if (i >= 0) spy.mock.calls[i] = [next];
      mockCtx.currentUser = next;
    } else {
      mockCtx.currentUser = arg;
    }
  });
  return spy;
}

beforeEach(() => {
  jest.clearAllMocks();

  // LocalStorage spies (common across tests)
  jest
    .spyOn(window.localStorage.__proto__, 'getItem')
    .mockImplementation((k) =>
      k === 'user' ? JSON.stringify({ id: 9, username: 'restored' }) : null
    );
  jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {});

  // By default, device has no keys → component takes key-setup paths
  loadKeysLocal.mockResolvedValue({ publicKey: null, privateKey: null });

  // Provide a fetch fallback if code touches it (we don’t rely on it though)
  global.fetch = mockFetchJson({ publicKey: null });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

test('restores user from localStorage when context is empty', async () => {
  mockCtx.currentUser = null;
  mockCtx.setCurrentUser = makeSetCurrentUserSpy();

  render(<BootstrapUser />);

  await waitFor(() =>
    expect(mockCtx.setCurrentUser).toHaveBeenCalledWith({ id: 9, username: 'restored' })
  );
});

test('does not open modal when server only has pubKey but no remote backup', async () => {
  mockCtx.currentUser = {
    id: 9,
    username: 'restored',
    publicKey: 'SERVER_HAS_ONE',
  };
  mockCtx.setCurrentUser = makeSetCurrentUserSpy();

  loadKeysLocal.mockResolvedValue({
    publicKey: null,
    privateKey: null,
  });

  render(<BootstrapUser />);

  const modal = await screen.findByTestId('key-modal');

  expect(modal.getAttribute('data-opened')).toBe('false');
  expect(modal.getAttribute('data-server')).toBe('true');
});

test('silently generates + uploads pubKey when user has no server pubKey', async () => {
  mockCtx.currentUser = { id: 9, username: 'restored', publicKey: null };
  mockCtx.setCurrentUser = makeSetCurrentUserSpy();

  // Component uses axiosClient; make sure GET/POST succeed
  axiosClient.post.mockResolvedValue({ data: { ok: true } });

  // Keypair generation path
  generateKeypair.mockReturnValue({ publicKey: 'PUB', privateKey: 'PRIV' });
  saveKeysLocal.mockResolvedValue();

  render(<BootstrapUser />);

  await waitFor(() => {
    expect(generateKeypair).toHaveBeenCalled();
    expect(axiosClient.post).toHaveBeenCalledWith('/users/keys', { publicKey: 'PUB' });
  });

  // persists user with new pubkey
  expect(mockCtx.setCurrentUser).toHaveBeenCalledWith(
    expect.objectContaining({ publicKey: 'PUB' })
  );
  expect(window.localStorage.setItem).toHaveBeenCalledWith(
    'user',
    expect.stringContaining('"publicKey":"PUB"')
  );
});
