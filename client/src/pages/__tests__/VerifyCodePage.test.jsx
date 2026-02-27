import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Router from 'react-router-dom';

import VerifyCodePage from '../VerifyCodePage';
import axiosClient from '@/api/axiosClient';

// Mock axios client
jest.mock('@/api/axiosClient', () => ({
  post: jest.fn(),
}));

describe('VerifyCodePage', () => {
  const navigateMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // default: provide a valid location state
    jest.spyOn(Router, 'useLocation').mockReturnValue({
      state: {
        pending: {
          username: ' alice ',
          email: 'alice@example.com',
          password: 'passw0rd',
          phone: '+15551234567',
        },
        verificationRequestId: 'ver-123',
      },
    });
    jest.spyOn(Router, 'useNavigate').mockReturnValue(navigateMock);
  });

  afterEach(() => {
    // restore spies so tests can override
    jest.restoreAllMocks();
  });

  it('redirects to /register when required state is missing', () => {
    // override location to simulate missing state
    jest.spyOn(Router, 'useLocation').mockReturnValue({ state: {} });
    // ensure navigate spy is used
    jest.spyOn(Router, 'useNavigate').mockReturnValue(navigateMock);

    const { container } = render(<VerifyCodePage />);

    // navigate should have been called with /register
    expect(navigateMock).toHaveBeenCalledWith('/register');
    // component returned null (nothing rendered)
    expect(container).toBeEmptyDOMElement();
  });

  it('submits code, calls verify and register endpoints, then navigates to /welcome (phoneVerificationId returned)', async () => {
    // Mock verify response to include phoneVerificationId
    axiosClient.post
      .mockResolvedValueOnce({ data: { phoneVerificationId: 'pv-1' } }) // verify
      .mockResolvedValueOnce({ data: { ok: true } }); // register

    render(<VerifyCodePage />);

    // Input label contains pending.phone
    expect(screen.getByLabelText(/Enter verification code sent to/i)).toBeInTheDocument();

    // Fill code and submit
    const input = screen.getByRole('textbox');
    userEvent.type(input, '123456');

    const btn = screen.getByRole('button', { name: /verify/i });
    userEvent.click(btn);

    // Wait for axios calls to finish
    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(2);
    });

    // First call: verify endpoint
    expect(axiosClient.post.mock.calls[0][0]).toBe('/auth/verify-phone-code');
    expect(axiosClient.post.mock.calls[0][1]).toEqual({
      verificationRequestId: 'ver-123',
      code: '123456',
    });

    // Second call: register endpoint payload: username/email trimmed, phoneVerificationId included
    expect(axiosClient.post.mock.calls[1][0]).toBe('/auth/register');
    expect(axiosClient.post.mock.calls[1][1]).toEqual({
      username: 'alice', // trimmed
      email: 'alice@example.com',
      password: 'passw0rd',
      phone: '+15551234567',
      phoneVerificationId: 'pv-1',
    });

    // Should navigate to welcome
    expect(navigateMock).toHaveBeenCalledWith('/welcome');
  });

  it('submits code and registers even if verify endpoint does NOT return phoneVerificationId', async () => {
    // verify returns empty data; register should still be called with undefined phoneVerificationId
    axiosClient.post
      .mockResolvedValueOnce({ data: {} }) // verify
      .mockResolvedValueOnce({ data: { ok: true } }); // register

    render(<VerifyCodePage />);

    userEvent.type(screen.getByRole('textbox'), '000000');
    userEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(2);
    });

    // Register payload should include phoneVerificationId: undefined
    expect(axiosClient.post.mock.calls[1][0]).toBe('/auth/register');
    expect(axiosClient.post.mock.calls[1][1]).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      password: 'passw0rd',
      phone: '+15551234567',
      phoneVerificationId: undefined,
    });

    expect(navigateMock).toHaveBeenCalledWith('/welcome');
  });

  it('shows error message when verification fails', async () => {
    // make verify request throw
    axiosClient.post.mockRejectedValueOnce(new Error('invalid'));

    render(<VerifyCodePage />);

    userEvent.type(screen.getByRole('textbox'), '999999');
    userEvent.click(screen.getByRole('button', { name: /verify/i }));

    // wait for error to be shown
    await waitFor(() => {
      expect(screen.getByText(/Invalid code or expired/i)).toBeInTheDocument();
    });

    // navigate should not be called
    expect(navigateMock).not.toHaveBeenCalledWith('/welcome');
  });
});