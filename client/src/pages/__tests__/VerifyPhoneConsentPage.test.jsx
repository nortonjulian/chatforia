import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as Router from 'react-router-dom';

// Mock the child component so we can inspect props and trigger callbacks
const VerifyPhoneConsentMock = jest.fn(({ phoneNumber, onContinue, onCancel }) => {
  return (
    <div>
      <div data-testid="phone">{phoneNumber}</div>
      <button onClick={() => onContinue()}>Continue</button>
      <button onClick={() => onCancel()}>Cancel</button>
    </div>
  );
});
jest.mock('../components/VerifyPhoneConsent', () => (props) => VerifyPhoneConsentMock(props));

const { default: VerifyPhoneConsentPage } = require('../VerifyPhoneConsentPage');

describe('VerifyPhoneConsentPage', () => {
  const navigateMock = jest.fn();
  const originalFetch = global.fetch;
  const originalAlert = global.alert;

  beforeEach(() => {
    jest.clearAllMocks();
    // default: location provides phoneNumber
    jest.spyOn(Router, 'useLocation').mockReturnValue({ state: { phoneNumber: '+15551234567' } });
    jest.spyOn(Router, 'useNavigate').mockReturnValue(navigateMock);

    global.fetch = jest.fn();
    global.alert = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    global.alert = originalAlert;
  });

  it('redirects to /register if no phoneNumber in location.state', () => {
    jest.spyOn(Router, 'useLocation').mockReturnValue({ state: {} });
    jest.spyOn(Router, 'useNavigate').mockReturnValue(navigateMock);

    const { container } = render(<VerifyPhoneConsentPage />);

    expect(navigateMock).toHaveBeenCalledWith('/register');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders VerifyPhoneConsent and onContinue -> successful request navigates to /verify-code with state', async () => {
    // Mock successful fetch response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });

    render(<VerifyPhoneConsentPage />);

    // Verify child component received phoneNumber prop
    expect(screen.getByTestId('phone').textContent).toBe('+15551234567');

    // Click Continue (calls sendOtp via onContinue)
    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Verify fetch called with correct args
    expect(global.fetch).toHaveBeenCalledWith('/auth/request-phone-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+15551234567' }),
    });

    // Should navigate to /verify-code with state containing phoneNumber
    expect(navigateMock).toHaveBeenCalledWith('/verify-code', { state: { phoneNumber: '+15551234567' } });
  });

  it('shows alert when server responds not ok (with JSON error) and does not navigate', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'rate limited' }),
    });

    render(<VerifyPhoneConsentPage />);

    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(global.alert).toHaveBeenCalledWith('Unable to send verification code. Please try again.');
    expect(navigateMock).not.toHaveBeenCalledWith('/verify-code', expect.anything());
  });

  it('shows alert when fetch throws (network error) and does not navigate', async () => {
    global.fetch.mockRejectedValueOnce(new Error('network failure'));

    render(<VerifyPhoneConsentPage />);

    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(global.alert).toHaveBeenCalledWith('Unable to send verification code. Please try again.');
    expect(navigateMock).not.toHaveBeenCalledWith('/verify-code', expect.anything());
  });

  it('calls onCancel -> navigate(-1)', () => {
    render(<VerifyPhoneConsentPage />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });
});