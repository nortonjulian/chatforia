import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

jest.mock('@/utils/analytics', () => ({
  __esModule: true,
  default: {
    capture: jest.fn(),
  },
}));

const mockT = (_key, defaultText) => defaultText || _key;


jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: mockT,
  }),
}));

import MyPlan from '../MyPlan.jsx';

describe('MyPlan page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderWithRouter = () =>
    render(
      <MemoryRouter>
        <MyPlan />
      </MemoryRouter>
    );

  test('shows loader text while fetching plan', async () => {
    let resolvePromise;

    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    renderWithRouter();

    expect(screen.getByText('My plan')).toBeInTheDocument();

    expect(
      screen.getByText('Loading your plan…')
    ).toBeInTheDocument();

    resolvePromise({
      data: {
        plan: {
          isFree: true,
          label: 'Free',
          status: 'active',
        },
      },
    });

    await waitFor(() => {
      expect(
        screen.queryByText('Loading your plan…')
      ).not.toBeInTheDocument();
    });
  });

  test('renders free plan data and upgrade CTA on success', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        plan: {
          label: 'Free',
          isFree: true,
          status: 'active',
          amountFormatted: '$0.00',
          currency: 'usd',
          interval: 'month',
          renewsAt: null,
        },
      },
    });

    renderWithRouter();

    expect(await screen.findByText('Free')).toBeInTheDocument();

    expect(
      screen.getByText(/upgrade to unlock more features/i)
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: /upgrade plan/i,
      })
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', {
        name: /manage billing/i,
      })
    ).not.toBeInTheDocument();

    expect(mockGet).toHaveBeenCalledWith('/billing/my-plan');
  });

  test('renders paid plan data, badge, renewal text and actions', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        plan: {
          label: 'Chatforia Premium',
          isFree: false,
          status: 'active',
          amountFormatted: '$25.00',
          currency: 'usd',
          interval: 'month',
          renewsAt: '2030-01-01T00:00:00.000Z',
        },
      },
    });

    renderWithRouter();

    expect(
      await screen.findByText('Chatforia Premium')
    ).toBeInTheDocument();

    expect(screen.getByText('active')).toBeInTheDocument();

    expect(
      screen.getByText(/renews on/i)
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: /change plan/i,
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: /manage billing/i,
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', {
        name: /cancel now/i,
      })
    ).toBeInTheDocument();

    expect(mockGet).toHaveBeenCalledWith('/billing/my-plan');
  });

  test('shows error message when request fails', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    mockGet.mockRejectedValueOnce(new Error('boom'));

    renderWithRouter();

    expect(
      await screen.findByText(/unable to load your plan/i)
    ).toBeInTheDocument();

    expect(
      screen.queryByText('Loading your plan…')
    ).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });
});