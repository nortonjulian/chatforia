import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

const mockPost = jest.fn();

jest.mock('../../api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
  },
}));

jest.mock('@/utils/analytics', () => ({
  __esModule: true,
  default: {
    capture: jest.fn(),
  },
}));

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, defaultText) => defaultText || _key,
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

    mockPost.mockImplementationOnce(
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
    mockPost.mockResolvedValueOnce({
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
      screen.getByText(
        /upgrade to unlock more features/i
      )
    ).toBeInTheDocument();

    expect(
      screen.getByRole('link', {
        name: /upgrade plan/i,
      })
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', {
        name: /manage billing/i,
      })
    ).not.toBeInTheDocument();

    expect(mockPost).toHaveBeenCalled();
  });

  test('renders paid plan data, badge, price and actions', async () => {
    mockPost.mockResolvedValueOnce({
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

    expect(
      screen.getByText(/\$25\.00/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/usd\/month/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/renews on/i)
    ).toBeInTheDocument();

    expect(
      screen.getByRole('link', {
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
  });

  test('shows error message when request fails', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    mockPost.mockRejectedValueOnce(new Error('boom'));

    renderWithRouter();

    expect(
      await screen.findByText(
        /unable to load your plan/i
      )
    ).toBeInTheDocument();

    expect(
      screen.queryByText('Loading your plan…')
    ).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });
});