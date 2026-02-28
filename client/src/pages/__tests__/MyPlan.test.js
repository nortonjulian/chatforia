import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import MyPlan from './MyPlan';

// Simple i18next mock: just return the default text if provided
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, defaultText) => defaultText || key,
  }),
}));

describe('MyPlan page', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const renderWithRouter = () =>
    render(
      <MemoryRouter>
        <MyPlan />
      </MemoryRouter>
    );

  test('shows loader text while fetching plan', async () => {
    // Keep the promise pending until after initial assertions
    let resolveJson;
    const jsonPromise = new Promise((resolve) => {
      resolveJson = resolve;
    });

    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => jsonPromise,
    });

    renderWithRouter();

    // Title is shown
    expect(screen.getByText('My plan')).toBeInTheDocument();

    // Loader state is shown
    expect(screen.getByText('Loading your plan…')).toBeInTheDocument();

    // Resolve the JSON to let component finish loading
    resolveJson({ plan: { isFree: true, label: 'Free', status: 'active' } });

    await waitFor(() =>
      expect(screen.queryByText('Loading your plan…')).not.toBeInTheDocument()
    );
  });

  test('renders free plan data and upgrade CTA on success', async () => {
    const plan = {
      label: 'Free',
      isFree: true,
      status: 'active',
      amountFormatted: '$0.00',
      currency: 'usd',
      interval: 'month',
      renewsAt: null,
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plan }),
    });

    renderWithRouter();

    // Wait for plan label to appear
    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
    });

    // Basic plan info
    expect(screen.getByText('Current plan')).toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument(); // no badge for free plan
    expect(
      screen.getByText(
        'You’re on the free plan. Upgrade to unlock more features.'
      )
    ).toBeInTheDocument();

    // CTA buttons
    expect(
      screen.getByRole('button', { name: 'Upgrade plan' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Manage billing' })
    ).toBeInTheDocument();

    // Fetch call was made correctly
    expect(fetch).toHaveBeenCalledWith('/api/billing/my-plan', {
      credentials: 'include',
    });
  });

  test('renders paid plan data, badge, price and change-plan CTA', async () => {
    const renewsAt = '2030-01-01T00:00:00.000Z';
    const plan = {
      label: 'Chatforia Premium',
      isFree: false,
      status: 'active',
      amountFormatted: '$25.00',
      currency: 'usd',
      interval: 'month',
      renewsAt,
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plan }),
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Chatforia Premium')).toBeInTheDocument();
    });

    // Badge with status
    expect(screen.getByText('active')).toBeInTheDocument();

    // Price line (currency uppercased + interval)
    expect(
      screen.getByText('$25.00 USD/month', { exact: false })
    ).toBeInTheDocument();

    // Renews date copy (just check prefix, since locale formatting varies)
    expect(
      screen.getByText(/Renews on/, { exact: false })
    ).toBeInTheDocument();

    // CTA should be "Change plan" for paid
    expect(
      screen.getByRole('button', { name: 'Change plan' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Manage billing' })
    ).toBeInTheDocument();
  });

  test('shows error message when fetch fails', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    renderWithRouter();

    await waitFor(() =>
      expect(
        screen.getByText('Unable to load your plan.')
      ).toBeInTheDocument()
    );

    // Loader should be gone in error state
    expect(screen.queryByText('Loading your plan…')).not.toBeInTheDocument();
  });
});
