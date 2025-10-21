import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LinkFlowPrimaryModal from '../LinkFlowPrimaryModal.jsx';

// ---------- Mocks ----------

// Mantine core (light shims)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Button = ({ children, onClick, disabled, variant, ...rest }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant || ''} {...rest}>
      {children}
    </button>
  );
  const Group = ({ children, ...rest }) => <div data-testid="group" {...rest}>{children}</div>;
  const Loader = () => <div role="progressbar" />;
  const Modal = ({ opened, onClose, title, children }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        <button aria-label="Close" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;
  const Stack = ({ children, ...rest }) => <div data-testid="stack" {...rest}>{children}</div>;
  const Text = ({ children, c, ...rest }) => <p data-color={c || ''} {...rest}>{children}</p>;
  return { Button, Group, Loader, Modal, Stack, Text };
});

// QRCode: expose the received "value"
jest.mock('react-qr-code', () => (props) => (
  <div data-testid="qrcode" data-value={props.value} />
));

// Crypto client fns (use mock* names so Jest allows them in factory)
const mockDeriveSharedKeyBrowser = jest.fn(async () => 'DERIVED_KEY');
const mockSealWithKey = jest.fn(() => ({ nonceB64: 'NONCE', ciphertextB64: 'CIPHERTEXT' }));

jest.mock('../../../utils/cryptoProvisionClient.js', () => ({
  __esModule: true,
  deriveSharedKeyBrowser: (...args) => mockDeriveSharedKeyBrowser(...args),
  sealWithKey: (...args) => mockSealWithKey(...args),
}));

// Encryption client export
const mockExportLocalPrivateKeyBundle = jest.fn(async () => ({ userPrivateKey: 'base64...', metadata: { v: 1 } }));
jest.mock('../../../utils/encryptionClient.js', () => ({
  __esModule: true,
  exportLocalPrivateKeyBundle: (...args) => mockExportLocalPrivateKeyBundle(...args),
}));

// fetch
const fetchMock = jest.fn();
global.fetch = fetchMock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  fetchMock.mockReset(); // IMPORTANT: reset implementations & calls per test
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

    // Initially disabled
    expect(screen.getByRole('button', { name: /approve & send key/i })).toBeDisabled();

    // Advance timers to trigger polling twice (interval 1500ms)
    jest.advanceTimersByTime(1500); // triggers 1st poll -> {}
    await Promise.resolve();

    jest.advanceTimersByTime(1500); // triggers 2nd poll -> { sPub: ... }
    await Promise.resolve();

    // Button becomes enabled after sPub is set — re-query & wait for enablement
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /approve & send key/i })).not.toBeDisabled()
    );
    const approveBtn = screen.getByRole('button', { name: /approve & send key/i });

    // Approve flow: export -> derive -> seal -> POST approve
    mockApproveOnce(true); // /devices/provision/approve

    fireEvent.click(approveBtn);

    // Button label transitions to "Sending…"
    expect(await screen.findByRole('button', { name: /sending…/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockExportLocalPrivateKeyBundle).toHaveBeenCalledTimes(1);
      expect(mockDeriveSharedKeyBrowser).toHaveBeenCalledWith('SECRET-XYZ', 'SERVER_PUB', '');
      expect(mockSealWithKey).toHaveBeenCalledWith('DERIVED_KEY', { userPrivateKey: 'base64...', metadata: { v: 1 } });
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

    // Loader first
    await screen.findByRole('progressbar');

    // Let the async effect catch and set step="error"
    await waitFor(() =>
      expect(screen.getByText(/failed to start provisioning|start failed/i)).toBeInTheDocument()
    );

    // Approve button should not be present in error step
    expect(screen.queryByRole('button', { name: /approve & send key/i })).not.toBeInTheDocument();
  });

  test('approve failure shows error message', async () => {
    mockStartOnce();
    mockPollOnce({ sPub: 'PUB' });
    await openModal();

    // Wait until ready UI is shown
    await screen.findByTestId('qrcode');

    // allow polling to set sPub -> enables button
    jest.advanceTimersByTime(1500);
    await Promise.resolve();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /approve & send key/i })).not.toBeDisabled()
    );

    // Approve fails
    mockApproveOnce(false);

    const approve = screen.getByRole('button', { name: /approve & send key/i });
    fireEvent.click(approve);

    expect(await screen.findByText(/failed to approve provisioning|approve failed/i)).toBeInTheDocument();
  });
});
