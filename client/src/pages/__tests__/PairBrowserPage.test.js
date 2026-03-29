import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import PairBrowserPage from './PairBrowserPage';

// Mock Navigate so we can assert redirects cleanly
jest.mock('react-router-dom', () => ({
  Navigate: ({ to }) => <div data-testid="navigate">Navigate:{to}</div>,
}));

// Mock user context
const mockUseUser = jest.fn();
jest.mock('@/context/UserContext', () => ({
  useUser: () => mockUseUser(),
}));

// Mock encryption client utils
const mockRequestBrowserPairing = jest.fn();
const mockFetchBrowserPairingStatus = jest.fn();
const mockTryInstallKeysFromApprovedPairing = jest.fn();
const mockGetLocalKeyBundleMeta = jest.fn();

jest.mock('@/utils/encryptionClient', () => ({
  requestBrowserPairing: (...args) => mockRequestBrowserPairing(...args),
  fetchBrowserPairingStatus: (...args) => mockFetchBrowserPairingStatus(...args),
  tryInstallKeysFromApprovedPairing: (...args) =>
    mockTryInstallKeysFromApprovedPairing(...args),
  getLocalKeyBundleMeta: (...args) => mockGetLocalKeyBundleMeta(...args),
}));

describe('PairBrowserPage', () => {
  let setNeedsKeyUnlock;
  let setKeyMeta;

  beforeEach(() => {
    jest.useFakeTimers();

    setNeedsKeyUnlock = jest.fn();
    setKeyMeta = jest.fn();

    mockUseUser.mockReturnValue({
      currentUser: { id: 'user-123' },
      authLoading: false,
      setNeedsKeyUnlock,
      setKeyMeta,
    });

    mockRequestBrowserPairing.mockResolvedValue({});
    mockFetchBrowserPairingStatus.mockResolvedValue({ device: {} });
    mockTryInstallKeysFromApprovedPairing.mockResolvedValue(false);
    mockGetLocalKeyBundleMeta.mockResolvedValue({ deviceId: 'browser-1' });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('redirects to home when auth is done and there is no currentUser', () => {
    mockUseUser.mockReturnValue({
      currentUser: null,
      authLoading: false,
      setNeedsKeyUnlock,
      setKeyMeta,
    });

    render(<PairBrowserPage />);

    expect(screen.getByTestId('navigate')).toHaveTextContent('Navigate:/');
  });

  test('shows initial pairing UI and starts pairing for authenticated user', async () => {
    render(<PairBrowserPage />);

    expect(screen.getByText(/secure browser pairing/i)).toBeInTheDocument();
    expect(screen.getByText(/starting secure pairing/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockRequestBrowserPairing).toHaveBeenCalledWith(null);
    });

    await waitFor(() => {
      expect(screen.getByText(/waiting for approval/i)).toBeInTheDocument();
      expect(
        screen.getByText(/open chatforia on your iphone and approve this browser/i)
      ).toBeInTheDocument();
    });
  });

  test('shows error if pairing start fails', async () => {
    mockRequestBrowserPairing.mockRejectedValueOnce(new Error('boom'));

    render(<PairBrowserPage />);

    await waitFor(() => {
      expect(screen.getByText(/pairing failed/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/could not start secure browser pairing/i)
    ).toBeInTheDocument();
  });

  test('shows timeout state if approval does not happen in time', async () => {
    render(<PairBrowserPage />);

    await waitFor(() => {
      expect(mockRequestBrowserPairing).toHaveBeenCalled();
    });

    act(() => {
      jest.advanceTimersByTime(45000);
    });

    await waitFor(() => {
      expect(screen.getByText(/pairing timed out/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/we did not receive approval in time/i)
    ).toBeInTheDocument();
  });

  test('shows revoked error when pairing request is revoked', async () => {
    mockFetchBrowserPairingStatus.mockResolvedValueOnce({
      device: { revokedAt: '2026-03-29T10:00:00Z' },
    });

    render(<PairBrowserPage />);

    await waitFor(() => {
      expect(mockRequestBrowserPairing).toHaveBeenCalled();
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText(/pairing failed/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/this browser pairing request was revoked/i)
    ).toBeInTheDocument();
  });

  test('shows rejected error when pairing is rejected on iPhone', async () => {
    mockFetchBrowserPairingStatus.mockResolvedValueOnce({
      device: { pairingStatus: 'rejected' },
    });

    render(<PairBrowserPage />);

    await waitFor(() => {
      expect(mockRequestBrowserPairing).toHaveBeenCalled();
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText(/pairing failed/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/this browser pairing request was rejected on iphone/i)
    ).toBeInTheDocument();
  });

  test('installs keys and redirects to chat when pairing is approved', async () => {
    mockFetchBrowserPairingStatus.mockResolvedValueOnce({
      device: {
        pairingStatus: 'approved',
        wrappedAccountKey: 'wrapped-key',
      },
    });
    mockTryInstallKeysFromApprovedPairing.mockResolvedValueOnce(true);
    mockGetLocalKeyBundleMeta.mockResolvedValueOnce({ keyId: 'abc123' });

    render(<PairBrowserPage />);

    await waitFor(() => {
      expect(mockRequestBrowserPairing).toHaveBeenCalled();
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockTryInstallKeysFromApprovedPairing).toHaveBeenCalledWith(null);
      expect(mockGetLocalKeyBundleMeta).toHaveBeenCalled();
      expect(setKeyMeta).toHaveBeenCalledWith({ keyId: 'abc123' });
      expect(setNeedsKeyUnlock).toHaveBeenCalledWith(false);
    });

    expect(screen.getByTestId('navigate')).toHaveTextContent('Navigate:/chat');
  });

  test('retry button starts pairing again', async () => {
    render(<PairBrowserPage />);

    await waitFor(() => {
      expect(mockRequestBrowserPairing).toHaveBeenCalledTimes(1);
    });

    const retryButton = screen.getByRole('button', { name: /retry pairing/i });

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockRequestBrowserPairing).toHaveBeenCalledTimes(2);
    });
  });

  test('retry button is disabled while pairing is active', async () => {
    render(<PairBrowserPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry pairing/i })).toBeDisabled();
    });
  });
});