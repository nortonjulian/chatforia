import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhoneWarningBanner from '@/components/PhoneWarningBanner.jsx';
import axiosClient from '@/api/axiosClient';

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock('@mantine/core', () => {
  const React = require('react');

  return {
    __esModule: true,
    Alert: ({ title, children }) => (
      <div role="alert">
        <strong>{title}</strong>
        {children}
      </div>
    ),
    Button: ({ children, onClick }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    Group: ({ children }) => <div>{children}</div>,
    Text: ({ children }) => <p>{children}</p>,
  };
});

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key) => {
      const map = {
        'phoneWarning.title': 'Your number is expiring soon',
        'phoneWarning.button': 'Keep my number',
      };

      return map[key] || key;
    },
  }),
  Trans: ({ values }) => (
    <>
      Your number <strong>{values.number}</strong> will be released on{' '}
      <strong>{values.date}</strong>.
    </>
  ),
}));

describe('PhoneWarningBanner', () => {
  const basePhone = {
    id: 'phone-123',
    e164: '+15551234567',
    status: 'HOLD',
    releaseAfter: '2100-01-01T00:00:00.000Z',
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
      releaseAfter: '2000-01-01T00:00:00.000Z',
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

    expect(
      screen.getByText(/your number is expiring soon/i)
    ).toBeInTheDocument();

    expect(screen.getByText(phone.e164)).toBeInTheDocument();
    expect(screen.getByText(expectedDate)).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /keep my number/i })
    ).toBeInTheDocument();
  });

  it('calls axiosClient.post and onReactivate when button is clicked', async () => {
    const phone = { ...basePhone };
    const onReactivate = jest.fn();

    axiosClient.post.mockResolvedValueOnce({ data: { ok: true } });

    render(<PhoneWarningBanner phone={phone} onReactivate={onReactivate} />);

    fireEvent.click(screen.getByRole('button', { name: /keep my number/i }));

    await waitFor(() => {
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

    fireEvent.click(screen.getByRole('button', { name: /keep my number/i }));

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(1);
      expect(onReactivate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to reactivate number:',
        error
      );
    });

    consoleSpy.mockRestore();
  });
});