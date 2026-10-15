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
}));

const mockT = (_key, defaultValueOrOptions, options) => {
  if (typeof defaultValueOrOptions === 'string') {
    if (options?.days != null) {
      return defaultValueOrOptions.replace(
        '{{days}}',
        String(options.days)
      );
    }

    return defaultValueOrOptions;
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
const { fetchWirelessStatus } = jest.requireMock('@/api/wireless');

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  jest.clearAllMocks();

  useUser.mockReturnValue({
    currentUser: { id: 1, username: 'julian' },
  });
});

describe('WirelessDashboard', () => {
  test('redirects to login when not authenticated', async () => {
    useUser.mockReturnValue({ currentUser: null });

    renderWithRouter(<WirelessDashboard />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?next=/wireless');
    });

    expect(fetchWirelessStatus).not.toHaveBeenCalled();
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
        /Your Chatforia eSIM is installed and your mobile service is active/i
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