import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---- Mocks ----

// Mantine minimal stubs
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>
      {children}
    </div>
  );
  const Button = ({ children, onClick, disabled, ...rest }) => (
    <button data-testid="btn-begin" onClick={onClick} disabled={!!disabled} {...rest}>
      {children}
    </button>
  );
  const Text = ({ children, ...rest }) => <div {...rest}>{children}</div>;
  const TextInput = ({ label, value, onChange, ...rest }) => (
    <label>
      {label}
      <input aria-label={label} value={value ?? ''} onChange={onChange} {...rest} />
    </label>
  );
  const PasswordInput = ({ label, value, onChange, ...rest }) => (
    <label>
      {label}
      <input
        type="password"
        aria-label={label}
        value={value ?? ''}
        onChange={onChange}
        {...rest}
      />
    </label>
  );
  const Textarea = ({ label, value, onChange, ...rest }) => (
    <label>
      {label}
      <textarea aria-label={label} value={value ?? ''} onChange={onChange} {...rest} />
    </label>
  );
  return {
    __esModule: true,
    Button,
    Card: passthru('card'),
    Group: passthru('group'),
    Stack: passthru('stack'),
    Text,
    Textarea,
    TextInput,
    PasswordInput,
  };
});

// Crypto helpers (define fns inside the factory to avoid out-of-scope references)
jest.mock('../../utils/cryptoProvisionClient.js', () => {
  return {
    __esModule: true,
    deriveSharedKeyBrowser: jest.fn(),
    openWithKey: jest.fn(),
  };
});

// Encryption client
jest.mock('../../utils/encryptionClient.js', () => ({
  __esModule: true,
  installLocalPrivateKeyBundle: jest.fn(),
}));

// Pull the mocks for easy reference
import {
  deriveSharedKeyBrowser,
  openWithKey,
} from '../../utils/cryptoProvisionClient.js';
import { installLocalPrivateKeyBundle } from '../../utils/encryptionClient.js';

// SUT
import LinkOnNewDevice from '../LinkOnNewDevice';

describe('LinkOnNewDevice', () => {
  let originalFetch;
  let originalUA;

  beforeAll(() => {
    jest.useFakeTimers();
    originalFetch = global.fetch;
    // Force a deterministic platform default
    originalUA = window.navigator.userAgent;
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Macintosh; Intel Mac OS X',
      configurable: true,
    });
  });

  afterAll(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    Object.defineProperty(window.navigator, 'userAgent', {
      value: originalUA,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupHappyFetchSequence({ sasCode = '123-456', readyAfter = 2 } = {}) {
    // Call order:
    // 1) POST /devices/provision/client-init -> { sasCode }
    // 2) GET /devices/provision/poll?linkId=... -> { ready:false }
    // 3) GET /devices/provision/poll?linkId=... -> { ready:true, sPub, nonce, ciphertext }
    // 4) POST /devices/register -> { ok:true }
    let pollCalls = 0;
    global.fetch = jest.fn(async (url, opts) => {
      if (url.startsWith('/devices/provision/client-init')) {
        return { ok: true, json: async () => ({ sasCode }) };
      }
      if (url.startsWith('/devices/provision/poll')) {
        pollCalls += 1;
        if (pollCalls < readyAfter) {
          return { ok: true, json: async () => ({ ready: false }) };
        }
        return {
          ok: true,
          json: async () => ({ ready: true, sPub: 'SPUB', nonce: 'NONCE', ciphertext: 'CIPH' }),
        };
      }
      if (url.startsWith('/devices/register')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });
  }

  test('button disabled until passcode length ≥ 6', () => {
    render(<LinkOnNewDevice />);

    const btn = screen.getByTestId('btn-begin');
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Set a passcode/i), { target: { value: '12345' } });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Set a passcode/i), { target: { value: '123456' } });
    expect(btn).not.toBeDisabled();
  });

  test('happy path: init -> SAS status, poll until ready, derive/open/install/register, final success', async () => {
    setupHappyFetchSequence({ sasCode: '321-654', readyAfter: 2 });

    // Make crypto mocks return a bundle
    deriveSharedKeyBrowser.mockResolvedValueOnce('SHARED_KEY');
    openWithKey.mockReturnValueOnce({ publicKey: 'PUBKEY-123', some: 'bundle' });
    installLocalPrivateKeyBundle.mockResolvedValueOnce(undefined);

    render(<LinkOnNewDevice />);

    // Fill in QR JSON + passcode + custom device name / platform
    const payload = {
      type: 'chatforia-provision',
      linkId: 'LINK-XYZ',
      secret: 'SECRET-ABC',
      sas: 'ignored-here',
    };
    fireEvent.change(screen.getByLabelText(/QR payload/i), {
      target: { value: JSON.stringify(payload) },
    });
    fireEvent.change(screen.getByLabelText(/Set a passcode/i), { target: { value: 'hunter2' } });

    fireEvent.change(screen.getByLabelText(/^Device name$/i), {
      target: { value: 'My Laptop' },
    });
    fireEvent.change(screen.getByLabelText(/^Platform$/i), {
      target: { value: 'macOS' },
    });

    // Begin
    fireEvent.click(screen.getByText(/Begin Linking/i));

    // After init call, SAS status should appear
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/devices/provision/client-init',
        expect.objectContaining({ method: 'POST' })
      )
    );
    await screen.findByText(/SAS:\s*321-654\. Awaiting approval…/i);

    // First poll (ready:false)
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await waitFor(() => {
      // We only care that a call was made whose URL contains the poll endpoint
      expect(
        global.fetch.mock.calls.some(
          ([u]) =>
            typeof u === 'string' && u.includes('/devices/provision/poll?linkId=LINK-XYZ')
        )
      ).toBe(true);
    });

    // Second poll (ready:true) -> triggers crypto + install + register
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(deriveSharedKeyBrowser).toHaveBeenCalledWith('SECRET-ABC', 'SPUB', '');
      expect(openWithKey).toHaveBeenCalledWith('SHARED_KEY', 'NONCE', 'CIPH');
      expect(installLocalPrivateKeyBundle).toHaveBeenCalledWith(
        expect.objectContaining({ publicKey: 'PUBKEY-123' }),
        'hunter2'
      );
      expect(global.fetch).toHaveBeenCalledWith(
        '/devices/register',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          credentials: 'include',
          body: JSON.stringify({
            linkId: 'LINK-XYZ',
            publicKey: 'PUBKEY-123',
            deviceName: 'My Laptop',
            platform: 'macOS',
          }),
        })
      );
    });

    // Final success status
    expect(screen.getByText(/Linked ✓ You can close this page\./i)).toBeInTheDocument();
  });

  test('invalid JSON shows error status', async () => {
    setupHappyFetchSequence();

    render(<LinkOnNewDevice />);

    fireEvent.change(screen.getByLabelText(/QR payload/i), { target: { value: '{not json}' } });
    fireEvent.change(screen.getByLabelText(/Set a passcode/i), { target: { value: '123456' } });

    fireEvent.click(screen.getByText(/Begin Linking/i));

    // Error status appears (message will include JSON parse error)
    expect(await screen.findByText(/Error:/i)).toBeInTheDocument();
  });
});
