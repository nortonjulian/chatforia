import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import WirelessDashboard from '../WirelessDashboard.jsx';

// ---- Mocks ----
jest.mock('../../context/UserContext', () => ({
  useUser: jest.fn(),
}));

jest.mock('../../api/wireless', () => ({
  fetchWirelessStatus: jest.fn(),
}));

jest.mock('../../api/billing', () => ({
  createEsimCheckoutSession: jest.fn(),
  createFamilyCheckoutSession: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  // simple i18n mock: returns defaultValue if provided, otherwise key
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

const { useUser } = jest.requireMock('../../context/UserContext');
const { fetchWirelessStatus } = jest.requireMock('../../api/wireless');
const {
  createEsimCheckoutSession,
  createFamilyCheckoutSession,
} = jest.requireMock('../../api/billing');

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  jest.clearAllMocks();

  // default logged-in user
  useUser.mockReturnValue({
    currentUser: { id: 1, username: 'julian' },
  });

  // default window.location mock for redirects
  delete window.location;
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

  test('shows "No family set up yet" and uses eSIM checkout when mode is NONE', async () => {
    fetchWirelessStatus.mockResolvedValue({
      mode: 'NONE',
    });

    createEsimCheckoutSession.mockResolvedValue({
      url: 'https://example.com/esim-checkout',
    });

    renderWithRouter(<WirelessDashboard />);

    // Wait for data load and NONE branch to render
    expect(await screen.findByText('No family set up yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'To create a Chatforia Family and shared data pool, start a Family plan.',
      ),
    ).toBeInTheDocument();

    const buyBtn = screen.getByRole('button', { name: 'Buy data pack' });
    await userEvent.click(buyBtn);

    await waitFor(() => {
      expect(createEsimCheckoutSession).toHaveBeenCalledWith('STARTER');
      expect(createFamilyCheckoutSession).not.toHaveBeenCalled();
      expect(window.location.href).toBe('https://example.com/esim-checkout');
    });
  });

  test('shows FAMILY pool details and LOW data alert, and uses Family checkout on top up', async () => {
    fetchWirelessStatus.mockResolvedValue({
      mode: 'FAMILY',
      state: 'LOW',
      source: {
        name: 'Norton Family',
        totalDataMb: 20480,        // 20 GB
        remainingDataMb: 1024,     // 1 GB
        daysRemaining: 3,
      },
    });

    createFamilyCheckoutSession.mockResolvedValue({
      url: 'https://example.com/family-checkout',
    });

    renderWithRouter(<WirelessDashboard />);

    // Wait for main view
    expect(await screen.findByText('Norton Family')).toBeInTheDocument();
    expect(screen.getByText('Shared data pool')).toBeInTheDocument();

    // Data summary: "20.0 GB / 1.0 GB"
    expect(screen.getByText(/20\.0 GB \/ 1\.0 GB/)).toBeInTheDocument();

    // Low data alert
    expect(
      screen.getByText('Your data is running low.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Expires in 3 days'),
    ).toBeInTheDocument();

    const topUpBtn = screen.getByRole('button', { name: 'Top up now' });
    await userEvent.click(topUpBtn);

    await waitFor(() => {
      expect(createFamilyCheckoutSession).toHaveBeenCalledWith('MEDIUM');
      expect(createEsimCheckoutSession).not.toHaveBeenCalled();
      expect(window.location.href).toBe('https://example.com/family-checkout');
    });
  });

  test('shows error message when wireless status fetch fails', async () => {
    fetchWirelessStatus.mockRejectedValue(new Error('boom'));

    renderWithRouter(<WirelessDashboard />);

    // After failure, we should see the load error text
    expect(
      await screen.findByText('Failed to load family details.'),
    ).toBeInTheDocument();
  });
});
