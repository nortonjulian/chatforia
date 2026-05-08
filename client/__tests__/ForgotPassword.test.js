import { jest } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { screen, act } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils';
import ForgotPassword from '../src/components/ForgotPassword.jsx';

const mockPost = jest.fn();

jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...args) => mockPost(...args) },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('rejects invalid email', async () => {
  const user = userEvent.setup();

  renderWithRouter(<ForgotPassword />);

  await act(async () => {
    await user.type(screen.getByLabelText(/^email/i), 'bad');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
  });

  expect(
    await screen.findByText(/please enter a valid email address/i)
  ).toBeInTheDocument();

  expect(mockPost).not.toHaveBeenCalled();
});

test('shows success message and preview link', async () => {
  const user = userEvent.setup();

  mockPost.mockResolvedValueOnce({
    data: { message: 'Sent!', previewUrl: 'http://preview' },
  });

  renderWithRouter(<ForgotPassword />);

  await act(async () => {
    await user.type(screen.getByLabelText(/^email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
  });

  expect(await screen.findByText(/sent!/i)).toBeInTheDocument();

  expect(screen.getByRole('link', { name: /preview email/i })).toHaveAttribute(
    'href',
    'http://preview'
  );
});