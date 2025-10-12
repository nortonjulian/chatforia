import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LinkFlowPrimaryModal from '@/components/LinkFlowPrimaryModal'; // adjust path if needed

// ---------- Mocks ----------

// Mantine core (light shims)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Button = ({ children, onClick, disabled, variant }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant || ''}>
      {children}
    </button>
  );
  const Group = ({ children }) => <div data-testid="group">{children}</div>;
  const Loader = () => <div role="progressbar" />;
  const Modal = ({ opened, onClose, title, children }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        <button aria-label="modal-internal-close" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;
  const Stack = ({ children }) => <div data-testid="stack">{children}</div>;
  const Text = ({ children, c }) => <p data-color={c || ''}>{children}</p>;
  return { Button, Group, Loader, Modal, Stack, Text };
});

// QRCode: expose the received "value"
jest.mock('react-qr-code', () => (props) => (
  <div data-testid="qrcode" data-value={props.value} />
));

// Crypto client fns
const deriveSharedKeyBrowser = jest.fn(async () => 'DERIVED_KEY');
const sealWithKey = jest.fn(() => ({ nonceB64: 'NONCE', ciphertextB64: 'CIPHERTEXT' }));
jest.mock('@/utils/cryptoProvisionClient.js', () => ({
  __esModule: true,
  deriveSharedKeyBrowser: (...args) => deriveSharedKeyBrowser(...args),
  sealWithKey: (...args) => sealWithKey(...args),
}));

// Encryption client export
const exportLocalPrivateKeyBundle = jest.fn(async () => ({ userPrivateKey: 'base64...', metadata: { v: 1 } }));
jest.mock('@/utils/encryptionClient.js', () => ({
  __esModule: true,
  exportLocalPrivateKeyBundle: (...args) => exportLocalPrivateKeyBundle(...args),
}));

// fetch
const fetchMock = jest.fn();
global.fetch = fetchMock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------- Helpers ----------
function mockStartOnce({ linkId = 'L123', qrPayload = { secret: 'S3CR3T', sas: 'AB-12' } } = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ linkId, qrPayload }),
  });
}

function mockPollOnce(body = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => body,
  });
}

function mockApproveOnce(ok = true) {
  if (ok) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  } else {
    fetchMock.mockRejectedValueOnce(new Error('approve failed'));
  }
}

async function openModal() {
  render(<LinkFlowPrimaryModal opened={true} onClose={jest.fn()} />);
  // Loader first while creating link
  await screen.findByRole('progressbar');
}

describe('LinkFlowPrimaryModal', () => {
  test('start → render QR & SAS; poll until sPub appears; approve sends sealed bundle', async () => {
    // 1) Start returns link data
    mockStartOnce({
      linkId: 'LINK-1',
      qrPayload: { secret: 'SECRET-XYZ', sas: 'ZX-99' },
    });

    // 2) Poll sequence: first empty, then with sPub
    mockPollOnce({}); // 1st poll
    mockPollOnce({ sPub: 'SERVER_PUB' }); // 2nd poll -> enables approval

    await openModal();

    // After start resolves, the modal should render QR and SAS
    await screen.findByTestId('qrcode');
    const qr = screen.getByTestId('qrcode');
    const qrValue = qr.getAttribute('data-value');
    expect(qrValue).toBe(JSON.stringify({ secret: 'SECRET-XYZ', sas: 'ZX-99' }));
    expect(screen.getByText(/SAS code:/i)).toHaveTextContent('ZX-99');

    // Initially, before sPub, Approve button should be disabled
    const approveBtn = screen.getByRole('button', { name: /approve & send key/i });
    expect(approveBtn).toBeDisabled();

    // Advance timers to trigger polling twice
    // Each poll interval is 1500ms
    jest.advanceTimersByTime(1500); // triggers 1st poll -> {}
    // Allow microtasks
    await Promise.resolve();

    jest.advanceTimersByTime(1500); // triggers 2nd poll -> { sPub: ... }
    await Promise.resolve();

    // Button becomes enabled after sPub is set
    expect(approveBtn).not.toBeDisabled();

    // Approve flow: export -> derive -> seal -> POST approve
    mockApproveOnce(true); // /devices/provision/approve

    fireEvent.click(approveBtn);

    // Button label transitions to "Sending…"
    expect(await screen.findByRole('button', { name: /sending…/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(exportLocalPrivateKeyBundle).toHaveBeenCalledTimes(1);
      expect(deriveSharedKeyBrowser).toHaveBeenCalledWith('SECRET-XYZ', 'SERVER_PUB', '');
      expect(sealWithKey).toHaveBeenCalledWith('DERIVED_KEY', { userPrivateKey: 'base64...', metadata: { v: 1 } });
    });

    await waitFor(() => {
      // Approve POST
      const approveCall = fetchMock.mock.calls.find(([url]) => url === '/devices/provision/approve');
      expect(approveCall).toBeTruthy();
      const [, opts] = approveCall;
      expect(opts.method).toBe('POST');
      expect(opts.headers).toMatchObject({
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      });
      const body = JSON.parse(opts.body);
      expect(body).toEqual({
        linkId: 'LINK-1',
        ciphertext: 'CIPHERTEXT',
        nonce: 'NONCE',
        sPub: 'SERVER_PUB',
      });
    });

    // Final button label "Sent ✓"
    expect(await screen.findByRole('button', { name: /sent ✓/i })).toBeInTheDocument();
  });

  test('close button calls onClose', async () => {
    mockStartOnce();
    mockPollOnce({}); // allow at least one poll
    const onClose = jest.fn();
    render(<LinkFlowPrimaryModal opened={true} onClose={onClose} />);

    // Wait for QR to appear
    await screen.findByTestId('qrcode');

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('start failure surfaces error and keeps in error step', async () => {
    fetchMock.mockRejectedValueOnce(new Error('start failed'));
    render(<LinkFlowPrimaryModal opened={true} onClose={() => {}} />);

    // Loader first, then an error message
    await screen.findByRole('progressbar');
    expect(await screen.findByText(/failed to start provisioning|start failed/i)).toBeInTheDocument();

    // Approve button should not be present yet (no link)
    expect(screen.queryByRole('button', { name: /approve & send key/i })).not.toBeInTheDocument();
  });

  test('approve failure shows error message', async () => {
    mockStartOnce();
    mockPollOnce({ sPub: 'PUB' });
    await openModal();
    // allow polling to set sPub
    jest.advanceTimersByTime(1500);
    await Promise.resolve();

    // Approve fails
    mockApproveOnce(false);

    const approve = screen.getByRole('button', { name: /approve & send key/i });
    fireEvent.click(approve);

    expect(await screen.findByText(/failed to approve provisioning|approve failed/i)).toBeInTheDocument();
  });
});
