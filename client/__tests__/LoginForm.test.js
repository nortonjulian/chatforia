/** @jest-environment jsdom */
import { jest } from '@jest/globals';

// ---- UserContext mock (match LoginForm’s import path resolution) ----
const mockSetCurrentUser = jest.fn();
jest.mock('../src/context/UserContext', () => ({
  __esModule: true,
  useUser: () => ({ setCurrentUser: mockSetCurrentUser }),
}));

// ---- react-router-dom mock ----
// Keep Link as actual to avoid needing React in this factory.
// Only override useNavigate.
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ---- axiosClient mock ----
const mockPost = jest.fn();
jest.mock('../src/api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...args) => mockPost(...args) },
}));

import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils';
import LoginForm from '../src/components/LoginForm.jsx';

beforeEach(() => {
  jest.clearAllMocks();
});

test('logs in successfully and navigates home', async () => {
  mockPost.mockResolvedValueOnce({ data: { user: { id: 1, username: 'alice' } } });

  renderWithRouter(<LoginForm />);

  await userEvent.type(screen.getByLabelText(/account/i), 'alice');
  await userEvent.type(screen.getByLabelText(/password/i), 'pass123');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith('/auth/login', { identifier: 'alice', password: 'pass123' });
    expect(mockSetCurrentUser).toHaveBeenCalledWith({ id: 1, username: 'alice' });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});

test('shows error on failed login', async () => {
  mockPost.mockRejectedValueOnce(new Error('bad creds'));

  renderWithRouter(<LoginForm />);

  await userEvent.type(screen.getByLabelText(/account/i), 'alice');
  await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));

  expect(await screen.findByText(/invalid username or password/i)).toBeInTheDocument();
});
