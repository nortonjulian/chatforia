import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '@/test-utils';
import NumberRegulatoryVerification from '@/components/profile/NumberRegulatoryVerification.jsx';
import axiosClient from '@/api/axiosClient';

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (_key, fallback) => fallback,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads and renders dynamic End User requirements', async () => {
  axiosClient.post.mockResolvedValueOnce({
    data: {
      initialized: true,
      profile: {
        status: 'NOT_STARTED',
        endUserSid: null,
      },
      requirements: {
        end_user: [
          {
            requirement_name: 'individual_info',
            type: 'individual',
            fields: ['first_name', 'last_name', 'document_number', 'email'],
          },
        ],
      },
    },
  });

  renderWithRouter(
    <NumberRegulatoryVerification
      e164="+61412345678"
      initialDecision="VERIFICATION_REQUIRED"
      initialResponse={{}}
      onBack={jest.fn()}
    />
  );

  await waitFor(() => {
    expect(axiosClient.post).toHaveBeenCalledWith(
      '/numbers/regulatory/initialize',
      {
        e164: '+61412345678',
      }
    );
  });

  expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();

  expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();

  expect(screen.getByLabelText(/document number/i)).toBeInTheDocument();

  expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
});

test('submits only the dynamically requested End User attributes', async () => {
  const user = userEvent.setup();

  axiosClient.post
    .mockResolvedValueOnce({
      data: {
        initialized: true,
        profile: {
          status: 'NOT_STARTED',
          endUserSid: null,
        },
        requirements: {
          end_user: [
            {
              requirement_name: 'individual_info',
              type: 'individual',
              fields: ['first_name', 'last_name', 'email'],
            },
          ],
        },
      },
    })
    .mockResolvedValueOnce({
      data: {
        initialized: true,
        profile: {
          status: 'NOT_STARTED',
          endUserSid: 'IT11111111111111111111111111111111',
        },
        requirements: {
          end_user: [
            {
              fields: ['first_name', 'last_name', 'email'],
            },
          ],
        },
      },
    });

  renderWithRouter(
    <NumberRegulatoryVerification
      e164="+61412345678"
      initialDecision="VERIFICATION_REQUIRED"
      initialResponse={{}}
      onBack={jest.fn()}
    />
  );

  await user.type(await screen.findByLabelText(/first name/i), 'Julian');

  await user.type(screen.getByLabelText(/last name/i), 'Norton');

  await user.type(screen.getByLabelText(/^email/i), 'julian@example.com');

  await user.click(screen.getByRole('button', { name: /^continue$/i }));

  await waitFor(() => {
    expect(axiosClient.post).toHaveBeenNthCalledWith(
      2,
      '/numbers/regulatory/initialize',
      {
        e164: '+61412345678',
        endUserAttributes: {
          first_name: 'Julian',
          last_name: 'Norton',
          email: 'julian@example.com',
        },
      }
    );
  });

  expect(
    await screen.findByText(/identity information is ready/i)
  ).toBeInTheDocument();
});
