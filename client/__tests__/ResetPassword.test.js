/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils.js';

const mockPost = jest.fn();

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: (...args) => mockPost(...args),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => {
      const translations = {
        'login.resetPassword.title':
          'Reset Password',

        'login.resetPassword.missingToken':
          'Invalid or missing token',

        'login.resetPassword.missingTokenHelper':
          'Invalid or missing token',

        'login.resetPassword.passwordMismatch':
          'Passwords do not match',

        'login.resetPassword.success':
          'Password has been reset successfully',

        'login.resetPassword.genericError':
          'Unable to reset password',

        'login.resetPassword.newPasswordLabel':
          'New password',

        'login.resetPassword.newPasswordPlaceholder':
          'Enter your new password',

        'login.resetPassword.confirmPasswordLabel':
          'Confirm new password',

        'login.resetPassword.confirmPasswordPlaceholder':
          'Confirm your new password',

        'login.resetPassword.resetting':
          'Resetting...',

        'login.resetPassword.submit':
          'Reset password',

        'login.resetPassword.strongPasswordHint':
          'Use a strong password',
      };

      return translations[key] ?? key;
    },
  }),
}));

import ResetPassword from '../src/components/ResetPassword.jsx';

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows error when token is missing', async () => {
  renderWithRouter(<ResetPassword />, {
    router: {
      initialEntries: ['/reset-password'],
    },
  });

  expect(
    await screen.findByRole('alert')
  ).toHaveTextContent(/invalid or missing token/i);
});

test('submits with token in URL and shows success', async () => {
  const user = userEvent.setup();

  mockPost.mockResolvedValueOnce({
    data: {
      message:
        'Password has been reset successfully.',
    },
  });

  renderWithRouter(<ResetPassword />, {
    router: {
      initialEntries: [
        '/reset-password?token=abc',
      ],
    },
  });

  await user.type(
    screen.getByLabelText(/^new password$/i),
    'x'
  );

  await user.type(
    screen.getByLabelText(
      /^confirm new password$/i
    ),
    'x'
  );

  await user.click(
    screen.getByRole('button', {
      name: /^reset password$/i,
    })
  );

  expect(
    await screen.findByText(
      /password has been reset successfully/i
    )
  ).toBeInTheDocument();

  expect(mockPost).toHaveBeenCalledWith(
    '/auth/reset-password',
    {
      token: 'abc',
      newPassword: 'x',
    }
  );
});

test('mismatched passwords show error', async () => {
  const user = userEvent.setup();

  renderWithRouter(<ResetPassword />, {
    router: {
      initialEntries: [
        '/reset-password?token=abc',
      ],
    },
  });

  await user.type(
    screen.getByLabelText(/^new password$/i),
    'a'
  );

  await user.type(
    screen.getByLabelText(
      /^confirm new password$/i
    ),
    'b'
  );

  await user.click(
    screen.getByRole('button', {
      name: /^reset password$/i,
    })
  );

  expect(
    await screen.findByRole('alert')
  ).toHaveTextContent(/passwords do not match/i);

  expect(mockPost).not.toHaveBeenCalled();
});