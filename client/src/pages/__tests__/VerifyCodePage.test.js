import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockNavigate = jest.fn();

let mockLocationState = {
  pendingRegistration: {
    username: ' alice ',
    email: 'alice@example.com',
    password: 'passw0rd',
    phone: '+15551234567',
  },
  verificationRequestId: 'ver-123',
};

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useLocation: () => ({
    state: mockLocationState,
  }),
  useNavigate: () => mockNavigate,
}));

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

import VerifyCodePage from '../VerifyCodePage';
import axiosClient from '@/api/axiosClient';

describe('VerifyCodePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockLocationState = {
      pendingRegistration: {
        username: ' alice ',
        email: 'alice@example.com',
        password: 'passw0rd',
        phone: '+15551234567',
      },
      verificationRequestId: 'ver-123',
    };
  });

  it('redirects to /register when required state is missing', () => {
    mockLocationState = {};

    const { container } = render(<VerifyCodePage />);

    expect(mockNavigate).toHaveBeenCalledWith('/register');
    expect(container).toBeEmptyDOMElement();
  });

  it('submits code, calls verify and register endpoints, then navigates to /welcome', async () => {
    const user = userEvent.setup();

    axiosClient.post
      .mockResolvedValueOnce({ data: { phoneVerificationId: 'pv-1' } })
      .mockResolvedValueOnce({ data: { ok: true } });

    render(<VerifyCodePage />);

    await user.type(screen.getByRole('textbox'), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(2);
    });

    expect(axiosClient.post.mock.calls[0][0]).toBe('/auth/verify-phone-code');
    expect(axiosClient.post.mock.calls[0][1]).toEqual({
      verificationRequestId: 'ver-123',
      code: '123456',
    });

    expect(axiosClient.post.mock.calls[1][0]).toBe('/auth/register');
    expect(axiosClient.post.mock.calls[1][1]).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      password: 'passw0rd',
      phone: '+15551234567',
      phoneVerificationId: 'pv-1',
    });

    expect(mockNavigate).toHaveBeenCalledWith('/welcome');
  });

  it('submits code and registers even if verify endpoint does not return phoneVerificationId', async () => {
    const user = userEvent.setup();

    axiosClient.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { ok: true } });

    render(<VerifyCodePage />);

    await user.type(screen.getByRole('textbox'), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(2);
    });

    expect(axiosClient.post.mock.calls[1][0]).toBe('/auth/register');
    expect(axiosClient.post.mock.calls[1][1]).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      password: 'passw0rd',
      phone: '+15551234567',
      phoneVerificationId: undefined,
    });

    expect(mockNavigate).toHaveBeenCalledWith('/welcome');
  });

  it('shows error message when verification fails', async () => {
    const user = userEvent.setup();
    axiosClient.post.mockRejectedValueOnce(new Error('invalid'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<VerifyCodePage />);

    await user.type(screen.getByRole('textbox'), '999999');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(
      await screen.findByText(/invalid code or expired/i)
    ).toBeInTheDocument();

    expect(mockNavigate).not.toHaveBeenCalledWith('/welcome');

    consoleSpy.mockRestore();
  });
});