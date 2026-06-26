import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils';
import ForgotPassword from '../src/components/ForgotPassword.jsx';

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
        'login.forgotPassword.title': 'Forgot Password',
        'login.forgotPassword.helper':
          'Enter your email to reset your password.',
        'login.forgotPassword.emailLabel': 'Email',
        'login.forgotPassword.emailPlaceholder':
          'Enter your email',
        'login.forgotPassword.emailInvalid':
          'Please enter a valid email address',
        'login.forgotPassword.genericError':
          'Something went wrong',
        'login.forgotPassword.sending': 'Sending...',
        'login.forgotPassword.sendCta': 'Send reset link',
        'login.forgotPassword.sentLabel': 'Sent!',
        'login.forgotPassword.sentHelper':
          'Check your email for the reset link.',
        'login.forgotPassword.previewDev': 'Preview email',
        'login.forgotPassword.backToLogin':
          'Back to login',
      };

      return translations[key] ?? key;
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('rejects invalid email', async () => {
  const user = userEvent.setup();

  renderWithRouter(<ForgotPassword />);

  await user.type(
    screen.getByRole('textbox', { name: /^email$/i }),
    'bad'
  );

  await user.click(
    screen.getByRole('button', {
      name: /send reset link/i,
    })
  );

  expect(
    await screen.findByRole('alert')
  ).toHaveTextContent(
    /please enter a valid email address/i
  );

  expect(mockPost).not.toHaveBeenCalled();
});

test('shows success message and preview link', async () => {
  const user = userEvent.setup();

  mockPost.mockResolvedValueOnce({
    data: {
      message: 'Sent!',
      previewUrl: 'http://preview',
    },
  });

  renderWithRouter(<ForgotPassword />);

  await user.type(
    screen.getByRole('textbox', { name: /^email$/i }),
    'a@b.com'
  );

  await user.click(
    screen.getByRole('button', {
      name: /send reset link/i,
    })
  );

  expect(
    await screen.findByText(/^sent!$/i)
  ).toBeInTheDocument();

  expect(
    screen.getByRole('link', {
      name: /preview email/i,
    })
  ).toHaveAttribute('href', 'http://preview');

  expect(mockPost).toHaveBeenCalledWith(
    '/auth/forgot-password',
    {
      email: 'a@b.com',
    }
  );
});