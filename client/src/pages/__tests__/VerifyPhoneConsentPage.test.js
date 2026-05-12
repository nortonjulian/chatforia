import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockUseLocation = jest.fn();

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
  useLocation: () => mockUseLocation(),
}));

const mockVerifyPhoneConsent = jest.fn(({ phoneNumber, onContinue, onCancel }) => {
  return (
    <div>
      <div data-testid="phone">{phoneNumber}</div>
      <button onClick={() => onContinue()}>Continue</button>
      <button onClick={() => onCancel()}>Cancel</button>
    </div>
  );
});

jest.mock('../../components/VerifyPhoneConsent', () => (props) =>
  mockVerifyPhoneConsent(props)
);

import VerifyPhoneConsentPage from '../VerifyPhoneConsentPage';

describe('VerifyPhoneConsentPage', () => {
  const originalFetch = global.fetch;
  const originalAlert = global.alert;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseLocation.mockReturnValue({
      state: { phoneNumber: '+15551234567' },
    });

    global.fetch = jest.fn();
    global.alert = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.alert = originalAlert;
    console.error = originalConsoleError;
  });

  it('redirects to /register if no phoneNumber in location.state', () => {
    mockUseLocation.mockReturnValue({ state: {} });

    const { container } = render(<VerifyPhoneConsentPage />);

    expect(mockNavigate).toHaveBeenCalledWith('/register');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders VerifyPhoneConsent and onContinue -> successful request navigates to /verify-code with state', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });

    render(<VerifyPhoneConsentPage />);

    expect(screen.getByTestId('phone')).toHaveTextContent('+15551234567');

    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(global.fetch).toHaveBeenCalledWith('/auth/request-phone-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+15551234567' }),
    });

    expect(mockNavigate).toHaveBeenCalledWith('/verify-code', {
      state: { phoneNumber: '+15551234567' },
    });
  });

  it('shows alert when server responds not ok and does not navigate', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'rate limited' }),
    });

    render(<VerifyPhoneConsentPage />);

    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(global.alert).toHaveBeenCalledWith(
      'Unable to send verification code. Please try again.'
    );

    expect(mockNavigate).not.toHaveBeenCalledWith(
      '/verify-code',
      expect.anything()
    );
  });

  it('shows alert when fetch throws and does not navigate', async () => {
    global.fetch.mockRejectedValueOnce(new Error('network failure'));

    render(<VerifyPhoneConsentPage />);

    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(global.alert).toHaveBeenCalledWith(
      'Unable to send verification code. Please try again.'
    );

    expect(mockNavigate).not.toHaveBeenCalledWith(
      '/verify-code',
      expect.anything()
    );
  });

  it('calls onCancel -> navigate(-1)', () => {
    render(<VerifyPhoneConsentPage />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});