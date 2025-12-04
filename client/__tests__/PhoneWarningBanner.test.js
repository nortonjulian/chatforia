import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhoneWarningBanner from './PhoneWarningBanner';

// Mock axiosClient
jest.mock('../api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

import axiosClient from '../api/axiosClient';

describe('PhoneWarningBanner', () => {
  const basePhone = {
    id: 'phone-123',
    e164: '+15551234567',
    status: 'HOLD',
    releaseAfter: '2100-01-01T00:00:00.000Z', // safely in the future
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render when phone is not on hold', () => {
    const phone = {
      ...basePhone,
      status: 'ACTIVE',
    };

    const { container } = render(
      <PhoneWarningBanner phone={phone} onReactivate={jest.fn()} />
    );

    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByText(/your number is expiring soon/i)
    ).not.toBeInTheDocument();
  });

  it('does not render when releaseAfter is in the past', () => {
    const phone = {
      ...basePhone,
      status: 'HOLD',
      releaseAfter: '2000-01-01T00:00:00.000Z', // safely in the past
    };

    const { container } = render(
      <PhoneWarningBanner phone={phone} onReactivate={jest.fn()} />
    );

    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByText(/your number is expiring soon/i)
    ).not.toBeInTheDocument();
  });

  it('renders warning when phone is on hold and release date is in the future', () => {
    const phone = { ...basePhone };
    const expectedDate = new Date(phone.releaseAfter).toDateString();

    render(<PhoneWarningBanner phone={phone} onReactivate={jest.fn()} />);

    // Title
    expect(
      screen.getByText(/your number is expiring soon/i)
    ).toBeInTheDocument();

    // Number
    expect(screen.getByText(phone.e164)).toBeInTheDocument();

    // Release date
    expect(screen.getByText(expectedDate)).toBeInTheDocument();

    // Button
    expect(
      screen.getByRole('button', { name: /keep my number/i })
    ).toBeInTheDocument();
  });

  it('calls axiosClient.post and onReactivate when button is clicked', async () => {
    const phone = { ...basePhone };
    const onReactivate = jest.fn();

    axiosClient.post.mockResolvedValueOnce({ data: { ok: true } });

    render(<PhoneWarningBanner phone={phone} onReactivate={onReactivate} />);

    const button = screen.getByRole('button', { name: /keep my number/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(1);
      expect(axiosClient.post).toHaveBeenCalledWith(
        `/api/phone/${phone.id}/reactivate`
      );
      expect(onReactivate).toHaveBeenCalledTimes(1);
    });
  });

  it('logs an error and does not call onReactivate when API fails', async () => {
    const phone = { ...basePhone };
    const onReactivate = jest.fn();
    const error = new Error('Network error');

    axiosClient.post.mockRejectedValueOnce(error);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<PhoneWarningBanner phone={phone} onReactivate={onReactivate} />);

    const button = screen.getByRole('button', { name: /keep my number/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(1);
      expect(onReactivate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      // Optional: check message prefix
      expect(consoleSpy.mock.calls[0][0]).toMatch(
        /failed to reactivate number/i
      );
    });

    consoleSpy.mockRestore();
  });
});
