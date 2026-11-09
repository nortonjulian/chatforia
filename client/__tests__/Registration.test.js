/** @jest-environment jsdom */
import { jest } from '@jest/globals';

// ---- react-router-dom mock (if your component navigates after success) ----
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
  default: {
    post: (...args) => mockPost(...args),
  },
}));

import userEvent from '@testing-library/user-event';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithRouter } from '../src/test-utils';
import Registration from '../src/components/Registration.jsx';
import { clearCreatorReferral, currentCreatorReferral } from '../src/utils/creatorReferral';

beforeEach(() => {
  jest.clearAllMocks();
  clearCreatorReferral();
});

test('validates email and shows error', async () => {
  const user = userEvent.setup();

  renderWithRouter(<Registration />);

  await act(async () => {
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(screen.getByRole('button', { name: /register/i }));
  });

  const alerts = await screen.findAllByRole('alert');

  expect(
    alerts.some((n) =>
      /enter a valid email/i.test(n.textContent || '') ||
      /please enter a valid email address/i.test(n.textContent || '')
    )
  ).toBe(true);

  expect(mockPost).not.toHaveBeenCalled();
});

test('submits on valid data', async () => {
  const user = userEvent.setup();

  mockPost.mockResolvedValueOnce({
    data: { user: { id: 2, username: 'bob' } },
  });

  renderWithRouter(<Registration />);

  await act(async () => {
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/email/i), 'bob@example.com');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /register/i }));
  });

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith('/auth/register', {
      username: 'bob',
      email: 'bob@example.com',
      password: 'secret123',
      referralCode: null,
    });
  });
});



 test('creator link is submitted, retained on failure and cleared after success', async () => {
  const user = userEvent.setup();
  mockPost.mockRejectedValueOnce({response: {status: 500}});
  mockPost.mockResolvedValueOnce({data: {user: {id: 3}}});
  renderWithRouter(<Registration />, {router: {initialEntries: ['/ref/PILOT_1']}});
  await user.type(screen.getByLabelText(/username/i), 'creatoruser');
  await user.type(screen.getByLabelText(/email/i), 'creator@example.com');
  await user.type(screen.getByLabelText(/password/i), 'secret123');
  await user.click(screen.getByRole('button', {name: /register/i}));
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  expect(currentCreatorReferral()).toBe('PILOT_1');
  expect(mockPost).toHaveBeenLastCalledWith('/auth/register', expect.objectContaining({referralCode: 'PILOT_1'}));
  await user.click(screen.getByRole('button', {name: /register/i}));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  expect(currentCreatorReferral()).toBeNull();
});
