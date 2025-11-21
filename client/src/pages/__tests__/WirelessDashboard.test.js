import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import WirelessDashboard from '../WirelessDashboard.jsx';

// ---- Mocks ----
// IMPORTANT: use the same module IDs as the component: '@/context/UserContext' & '@/api/wireless'
jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: jest.fn(),
}));

jest.mock('@/api/wireless', () => ({
  __esModule: true,
  fetchWirelessStatus: jest.fn(),
}));

// simple i18n mock: returns defaultValue if provided, otherwise key
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, defaultValueOrOptions) => {
      if (typeof defaultValueOrOptions === 'string') {
        return defaultValueOrOptions;
      }
      return key;
    },
  }),
}));

// react-router useNavigate mock
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// grab the mocked fns
const { useUser } = jest.requireMock('@/context/UserContext');
const { fetchWirelessStatus } = jest.requireMock('@/api/wireless');

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  jest.clearAllMocks();

  // default logged-in user
  useUser.mockReturnValue({
    currentUser: { id: 1, username: 'julian' },
  });

  // mock window.location (even though we just use navigate)
  // eslint-disable-next-line no-global-assign
  delete window.location;
  // @ts-ignore
  window.location = { href: '' };
});

describe('WirelessDashboard', () => {
  test('redirects to login when not authenticated', async () => {
    useUser.mockReturnValue({ currentUser: null });
    fetchWirelessStatus.mockResolvedValue({ mode: 'NONE' });

    renderWithRouter(<WirelessDashboard />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login?next=/wireless');
    });
  });

  test('shows "No wireless plan yet" and navigates to /upgrade when viewing plans', async () => {
    fetchWirelessStatus.mockResolvedValue({
      mode: 'NONE',
    });

    renderWithRouter(<WirelessDashboard />);

    // Make sure the fetch actually ran and the effect completed once
    await waitFor(() => {
      expect(fetchWirelessStatus).toHaveBeenCalledTimes(1);
    });

    // Now the loading state should be gone and NONE branch rendered
    expect(
      await screen.findByText(/No wireless plan yet/i),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /You can buy mobile data to use Chatforia away from Wi-Fi, either just for you or for a Family group\./i,
      ),
    ).toBeInTheDocument();

    const viewPlansBtn = screen.getByRole('button', { name: /View plans/i });
    await userEvent.click(viewPlansBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
    });
  });

  test('shows FAMILY pool details and LOW data alert, and uses /upgrade on top up', async () => {
    fetchWirelessStatus.mockResolvedValue({
      mode: 'FAMILY',
      state: 'LOW',
      source: {
        name: 'Norton Family',
        totalDataMb: 20480, // 20 GB
        remainingDataMb: 1024, // 1 GB
        daysRemaining: 3,
      },
    });

    renderWithRouter(<WirelessDashboard />);

    // Ensure fetch was called so the effect runs
    await waitFor(() => {
      expect(fetchWirelessStatus).toHaveBeenCalledTimes(1);
    });

    // Wait for main FAMILY view
    expect(
      await screen.findByText(/Norton Family/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Shared data pool/i)).toBeInTheDocument();

    // Data summary: "20.0 GB / 1.0 GB"
    expect(
      screen.getByText(/20\.0 GB \/ 1\.0 GB/),
    ).toBeInTheDocument();

    // Low data alert
    expect(
      screen.getByText(/Your data is running low\./i),
    ).toBeInTheDocument();
    // Our i18n mock doesn’t interpolate {{days}}, so we assert on the default template
    expect(
      screen.getByText(/Expires in \{\{days\}\} days/i),
    ).toBeInTheDocument();

    const topUpBtn = screen.getByRole('button', {
      name: /Top up \/ change plan/i,
    });
    await userEvent.click(topUpBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/upgrade');
    });
  });

  test('shows error message when wireless status fetch fails', async () => {
    fetchWirelessStatus.mockRejectedValue(new Error('boom'));

    renderWithRouter(<WirelessDashboard />);

    // Ensure the fetch ran and the error path executed
    await waitFor(() => {
      expect(fetchWirelessStatus).toHaveBeenCalledTimes(1);
    });

    // After failure, we should see the load error text
    expect(
      await screen.findByText(
        /Failed to load wireless details\. Please try again\./i,
      ),
    ).toBeInTheDocument();
  });
});
