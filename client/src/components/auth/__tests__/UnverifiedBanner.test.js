import { render, screen, fireEvent } from '@testing-library/react';
import UnverifiedBanner from '@/components/auth/UnverifiedBanner';

// ---- Mocks ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Alert = ({ children, title, ...p }) => (
    <div role="alert" data-title={title} {...p}>{children}</div>
  );
  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const Group = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Text = ({ children, ...p }) => <p {...p}>{children}</p>;
  return { Alert, Button, Group, Text };
});

const fetchMock = jest.fn();
global.fetch = fetchMock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('UnverifiedBanner', () => {
  test('returns null when email and phone are verified', () => {
    const { container } = render(
      <UnverifiedBanner user={{ emailVerifiedAt: '2024-01-01', phoneVerifiedAt: '2024-01-02' }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('email-only unverified: shows message, resend button triggers fetch, no phone button', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    render(
      <UnverifiedBanner user={{ email: 'a@b.com', emailVerifiedAt: null, phoneVerifiedAt: 'x' }} />
    );

    // Correct banner + message
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/verify your email to unlock full features/i)).toBeInTheDocument();

    // Resend email button present & works
    const resendBtn = screen.getByRole('button', { name: /resend email/i });
    expect(resendBtn).toBeInTheDocument();
    fireEvent.click(resendBtn);
    expect(fetchMock).toHaveBeenCalledWith('/auth/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    });

    // No phone button
    expect(screen.queryByRole('button', { name: /verify phone/i })).not.toBeInTheDocument();
  });

  test('phone-only unverified: shows message and verify phone button calls onOpenPhone', () => {
    const onOpenPhone = jest.fn();
    render(
      <UnverifiedBanner
        user={{ emailVerifiedAt: 'x', phoneVerifiedAt: null }}
        onOpenPhone={onOpenPhone}
      />
    );

    expect(screen.getByText(/verify your phone to use calling\/sms/i)).toBeInTheDocument();

    const phoneBtn = screen.getByRole('button', { name: /verify phone/i });
    fireEvent.click(phoneBtn);
    expect(onOpenPhone).toHaveBeenCalledTimes(1);

    // No resend email button
    expect(screen.queryByRole('button', { name: /resend email/i })).not.toBeInTheDocument();
  });

  test('both unverified: shows email message and both action buttons', () => {
    const onOpenPhone = jest.fn();
    render(
      <UnverifiedBanner
        user={{ email: 'c@d.com', emailVerifiedAt: null, phoneVerifiedAt: null }}
        onOpenPhone={onOpenPhone}
      />
    );

    // Message prefers email path when both are needed
    expect(screen.getByText(/verify your email to unlock full features/i)).toBeInTheDocument();

    // Both buttons present
    expect(screen.getByRole('button', { name: /resend email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify phone/i })).toBeInTheDocument();
  });
});
