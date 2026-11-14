import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import WirelessDashboard from '../WirelessDashboard.jsx';

// ---- Mocks ----
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: jest.fn(),
}));

jest.mock('@/api/wireless', () => ({
  __esModule: true,
  fetchWirelessStatus: jest.fn(),
  fetchWirelessPurchases: jest.fn(),
}));

const mockT = (_key, defaultValueOrOptions, options) => {
  if (typeof defaultValueOrOptions === 'string') {
    return Object.entries(options || {}).reduce(
      (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
      defaultValueOrOptions
    );
  }

  return _key;
};

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: mockT,
  }),
}));

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const { useUser } = jest.requireMock('@/context/UserContext');
const { fetchWirelessStatus, fetchWirelessPurchases } = jest.requireMock('@/api/wireless');

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  jest.clearAllMocks();

  useUser.mockReturnValue({
    currentUser: { id: 1, username: 'julian' },
  });
  fetchWirelessPurchases.mockResolvedValue({ packages: [], replacementEligibility: null });
});

describe('WirelessDashboard', () => {
  test('redirects to login when not authenticated', async () => {
    useUser.mockReturnValue({ currentUser: null });

    renderWithRouter(<WirelessDashboard />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?next=/wireless');
    });

    expect(fetchWirelessStatus).not.toHaveBeenCalled();
    expect(fetchWirelessPurchases).not.toHaveBeenCalled();
  });

  test('keeps expired paid packages visible without calling them queued or transferable', async () => {
    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'INDIVIDUAL', state: 'EXPIRED', expired: true,
      source: { addonKind: 'chatforia_esim_local_3_premium', totalDataMb: 3072, remainingDataMb: 3072 },
    });
    fetchWirelessPurchases.mockResolvedValueOnce({
      packages: [{
        id: 43, addonKind: 'chatforia_esim_local_3_premium',
        state: 'TERMINATED', paid: true,
        totalDataMb: 3072, remainingDataMb: 3072, recordedRemainingDataMb: 3072,
        expiresAt: '2026-11-13T19:27:49.000Z',
      }],
      replacementEligibility: { eligible: false, reason: 'No active package remains.' },
    });

    renderWithRouter(<WirelessDashboard />);

    expect(await screen.findByText('Purchased Data Packages')).toBeInTheDocument();
    expect(screen.getByText('terminated')).toBeInTheDocument();
    expect(screen.getByText(/Recorded remaining: 3.0 GB of 3.0 GB/)).toBeInTheDocument();
    expect(screen.getByText(/eSIM transfer unavailable: No active package remains/)).toBeInTheDocument();
    expect(screen.queryByText(/Queued data packs/)).not.toBeInTheDocument();
  });

  test('shows Get a data plan and navigates to /upgrade when viewing plans', async () => {
    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'NONE',
    });

    renderWithRouter(<WirelessDashboard />);

    expect(await screen.findByText(/Get a data plan/i)).toBeInTheDocument();

    expect(
      screen.getByText(
        /Once your eSIM is installed, choose a data plan to use Chatforia on mobile\./i
      )
    ).toBeInTheDocument();

    const viewPlansBtn = screen.getByRole('button', { name: /View plans/i });

    await userEvent.click(viewPlansBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
    expect(fetchWirelessStatus).toHaveBeenCalled();
  });

  test('shows FAMILY pool details and LOW data alert, and uses /upgrade on top up', async () => {
    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'FAMILY',
      state: 'LOW',
      source: {
        name: 'Norton Family',
        totalDataMb: 20480,
        remainingDataMb: 1024,
        daysRemaining: 3,
      },
    });

    renderWithRouter(<WirelessDashboard />);

    expect(await screen.findByText(/Norton Family/i)).toBeInTheDocument();
    expect(screen.getByText(/Family data pool/i)).toBeInTheDocument();

    expect(screen.getByText(/20\.0 GB \/ 1\.0 GB/i)).toBeInTheDocument();

    expect(
      screen.getByText(/Your data is running low\./i)
    ).toBeInTheDocument();

    expect(screen.getByText(/Expires in 3 days/i)).toBeInTheDocument();

    const topUpBtn = await screen.findByRole('button', {
      name: /Top up \/ change plan/i,
    });

    await userEvent.click(topUpBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
    expect(fetchWirelessStatus).toHaveBeenCalled();
  });

  test('shows ACTIVE eSIM management state and masks the ICCID', async () => {
    useUser.mockReturnValue({
      currentUser: {
        id: 1,
        username: 'julian',
        subscriber: {
          status: 'ACTIVE',
          iccid: '8910300000059080801',
        },
      },
    });

    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'INDIVIDUAL',
      state: 'ACTIVE',
      source: {
        totalDataMb: 3072,
        remainingDataMb: 2867,
      },
    });

    renderWithRouter(<WirelessDashboard />);

    expect(
      await screen.findByText(/Your eSIM is active/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /Your Chatforia data eSIM is installed and active/i
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(/ICCID:.*0801/i)
    ).toBeInTheDocument();

    expect(
      screen.queryByText(/8910300000059080801/)
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText(/re-scan your QR code/i)
    ).not.toBeInTheDocument();

    const manageButton = screen.getByRole('button', {
      name: /Manage eSIM/i,
    });

    await userEvent.click(manageButton);

    expect(mockNavigate).toHaveBeenCalledWith('/account/esim');
  });

  test('shows Unlimited as a plan instead of zero data', async () => {
    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'INDIVIDUAL',
      state: 'OK',
      source: {
        addonKind: 'chatforia_esim_global_unlimited_premium',
        unlimited: true,
        totalDataMb: 0,
        remainingDataMb: 0,
      },
      queuedPacks: [{
        addonKind: 'chatforia_esim_europe_unlimited_premium',
        unlimited: true,
        remainingDataMb: 0,
      }],
    });

    renderWithRouter(<WirelessDashboard />);

    expect(await screen.findByText('Unlimited data')).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 GB \/ 0\.0 GB/)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(/Europe Unlimited \(Unlimited data\)/)).toBeInTheDocument();
  });

  test('does not describe a queued package as active or suggest another purchase', async () => {
    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'INDIVIDUAL',
      state: 'AWAITING_ACTIVATION',
      source: {
        addonKind: 'chatforia_esim_local_3_premium',
        totalDataMb: 3072,
        remainingDataMb: 3072,
      },
    });

    renderWithRouter(<WirelessDashboard />);

    expect(await screen.findByText(/not confirmed active/i)).toBeInTheDocument();
    expect(screen.getByText(/before buying again/i)).toBeInTheDocument();
    expect(screen.queryByText(/keeps Chatforia working when you’re away from Wi-Fi/i)).not.toBeInTheDocument();
  });

  test('keeps eSIM setup available while the subscriber is PROVISIONING', async () => {
    useUser.mockReturnValue({
      currentUser: {
        id: 1,
        username: 'julian',
        subscriber: {
          status: 'PROVISIONING',
          iccid: '8910300000059080801',
          activationCode: 'ABC123',
        },
      },
    });

    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'INDIVIDUAL',
      state: 'ACTIVE',
      source: {
        totalDataMb: 3072,
        remainingDataMb: 3072,
      },
    });

    renderWithRouter(<WirelessDashboard />);

    expect(
      await screen.findByRole('heading', {
        name: /Set up your eSIM/i,
      })
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /Your Chatforia eSIM is ready to install. Open setup to continue activation/i
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(/ICCID:.*0801/i)
    ).toBeInTheDocument();

    expect(
      screen.queryByText(/8910300000059080801/)
    ).not.toBeInTheDocument();

    const setupButton = screen.getByRole('button', {
      name: /Open eSIM setup/i,
    });

    await userEvent.click(setupButton);

    expect(mockNavigate).toHaveBeenCalledWith('/account/esim');
  });

  test('shows a readable Local 3 GB label for a purchased eSIM', async () => {
    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'INDIVIDUAL',
      state: 'ACTIVE',
      source: {
        addonKind: 'chatforia_esim_local_3_premium',
        totalDataMb: 3072,
        remainingDataMb: 3072,
      },
    });

    renderWithRouter(<WirelessDashboard />);

    expect(await screen.findByText('Local 3 GB')).toBeInTheDocument();
    expect(
      screen.queryByText('chatforia_esim_local_3_premium')
    ).not.toBeInTheDocument();
  });

  test('keeps unknown package identifiers visible rather than mislabeling them', async () => {
    fetchWirelessStatus.mockResolvedValueOnce({
      mode: 'INDIVIDUAL',
      state: 'ACTIVE',
      source: {
        addonKind: 'new_provider_package',
        totalDataMb: 3072,
        remainingDataMb: 3072,
      },
    });

    renderWithRouter(<WirelessDashboard />);

    expect(await screen.findByText('new_provider_package')).toBeInTheDocument();
  });

  test('shows error message when wireless status fetch fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    fetchWirelessStatus.mockRejectedValueOnce(new Error('boom'));

    renderWithRouter(<WirelessDashboard />);

    expect(
      await screen.findByText(
        /Failed to load wireless details\. Please try again\./i
      )
    ).toBeInTheDocument();

    expect(fetchWirelessStatus).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
