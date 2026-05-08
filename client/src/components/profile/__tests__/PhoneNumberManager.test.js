import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithRouter } from '@/test-utils';
import PhoneNumberManager from '@/components/profile/PhoneNumberManager.jsx';
import axiosClient from '@/api/axiosClient';

const mockCurrentUser = {
  id: 'user-1',
  plan: 'FREE',
};

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('@/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({
    currentUser: mockCurrentUser,
  }),
}));

jest.mock('@/components/PhoneWarningBanner.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="phone-warning-banner" />,
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
    t: (_key, fallback, vars) => {
      if (vars?.count != null && typeof fallback === 'string') {
        return fallback.replace('{{count}}', vars.count);
      }
      return fallback;
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();

  axiosClient.get.mockImplementation((url) => {
    if (url === '/numbers/my') {
      return Promise.resolve({
        data: {
          number: null,
        },
      });
    }

    if (url === '/numbers/pool') {
      return Promise.resolve({
        data: {
          numbers: [
            {
              e164: '+15551234567',
              locality: 'Denver',
              region: 'CO',
              capabilities: {
                sms: true,
                voice: true,
              },
            },
          ],
        },
      });
    }

    return Promise.resolve({ data: {} });
  });

  axiosClient.post.mockResolvedValue({ data: {} });
});

test('loads no-number state and opens the number picker', async () => {
  const user = userEvent.setup();

  renderWithRouter(<PhoneNumberManager />);

  expect(await screen.findByText(/phone number/i)).toBeInTheDocument();
  expect(await screen.findByText(/no number/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /pick a number/i }));

  expect(await screen.findByText(/available number/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument();

  expect(axiosClient.get).toHaveBeenCalledWith('/numbers/my');
});

test('searches available pool numbers and assigns selected number', async () => {
  const user = userEvent.setup();

  renderWithRouter(<PhoneNumberManager />);

  await screen.findByText(/no number/i);

  await user.click(screen.getByRole('button', { name: /pick a number/i }));
  await user.click(screen.getByRole('button', { name: /^search$/i }));

  const numberText = await screen.findByText(/\(555\) 123-4567/i);
  expect(numberText).toBeInTheDocument();

  const resultCard = numberText.closest('[data-testid="card"]');
  expect(resultCard).toBeTruthy();

  expect(within(resultCard).getByText(/denver, co/i)).toBeInTheDocument();
  expect(within(resultCard).getByText(/^sms$/i)).toBeInTheDocument();
  expect(within(resultCard).getByText(/^voice$/i)).toBeInTheDocument();

  await user.click(within(resultCard).getByRole('button', { name: /^select$/i }));

  await waitFor(() => {
    expect(axiosClient.post).toHaveBeenCalledWith('/numbers/lease', {
      e164: '+15551234567',
      lockOnAssign: false,
    });
  });

  expect(await screen.findByText(/number assigned/i)).toBeInTheDocument();
});

test('shows active assigned number from /numbers/my', async () => {
  axiosClient.get.mockImplementation((url) => {
    if (url === '/numbers/my') {
      return Promise.resolve({
        data: {
          number: {
            e164: '+15559876543',
            status: 'ACTIVE',
            capabilities: {
              sms: true,
              voice: true,
            },
            keepLocked: false,
          },
        },
      });
    }

    return Promise.resolve({ data: {} });
  });

  renderWithRouter(<PhoneNumberManager />);

  expect(await screen.findByText(/\(555\) 987-6543/i)).toBeInTheDocument();
  expect(screen.getByText(/\+15559876543/i)).toBeInTheDocument();
  expect(screen.getByText(/active/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /release/i })).toBeInTheDocument();
});