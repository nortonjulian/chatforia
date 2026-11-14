import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';

import TwoFASection from '../TwoFASection';
import { disableTwoFactor } from '@/api/twoFactor';

jest.mock('@/api/twoFactor', () => ({
  disableTwoFactor: jest.fn(),
}));

jest.mock('@/components/auth/TwoFASetupModal.jsx', () => {
  return function MockSetupModal({ opened, onClose }) {
    if (!opened) return null;

    return (
      <div role="dialog" aria-label="MFA setup">
        <button onClick={() => onClose(false)}>
          Cancel setup
        </button>
        <button onClick={() => onClose(true)}>
          Complete setup
        </button>
      </div>
    );
  };
});

jest.mock('@mantine/core', () => {
  const React = require('react');

  const Wrap = ({ children }) => <div>{children}</div>;

  const Modal = ({ opened, title, children }) =>
    opened ? (
      <section role="dialog" aria-label={title}>
        {children}
      </section>
    ) : null;

  const Button = ({ children, onClick, disabled, loading }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
    >
      {children}
    </button>
  );

  const TextInput = ({ label, value, onChange }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={onChange}
      />
    </label>
  );

  const Text = ({ children, role }) => (
    <p role={role}>{children}</p>
  );

  const Badge = ({ children }) => <span>{children}</span>;

  return {
    Badge,
    Button,
    Group: Wrap,
    Modal,
    Stack: Wrap,
    Text,
    TextInput,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TwoFASection', () => {
  test('shows enrollment when MFA is disabled', () => {
    render(
      <TwoFASection
        user={{ twoFactorEnabled: false }}
        onChange={jest.fn()}
      />
    );

    expect(screen.getByText('Disabled')).toBeInTheDocument();

    expect(screen.getByRole('button', {
      name: 'Enable two-factor authentication',
    })).toBeInTheDocument();
  });

  test('opens enrollment and refreshes after completion', async () => {
    const onChange = jest.fn().mockResolvedValue();

    render(
      <TwoFASection
        user={{ twoFactorEnabled: false }}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Enable two-factor authentication',
    }));

    expect(screen.getByRole('dialog', {
      name: 'MFA setup',
    })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: 'Complete setup',
    }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  test('cancelling enrollment does not refresh the account', () => {
    const onChange = jest.fn();

    render(
      <TwoFASection
        user={{ twoFactorEnabled: false }}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Enable two-factor authentication',
    }));

    fireEvent.click(screen.getByRole('button', {
      name: 'Cancel setup',
    }));

    expect(onChange).not.toHaveBeenCalled();
  });

  test('shows disable control when MFA is enabled', () => {
    render(
      <TwoFASection
        user={{ twoFactorEnabled: true }}
        onChange={jest.fn()}
      />
    );

    expect(screen.getByText('Enabled')).toBeInTheDocument();

    expect(screen.getByRole('button', {
      name: 'Disable two-factor authentication',
    })).toBeInTheDocument();
  });

  test('invalid disable codes cannot be submitted', () => {
    render(
      <TwoFASection
        user={{ twoFactorEnabled: true }}
        onChange={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Disable two-factor authentication',
    }));

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '12345' },
    });

    expect(screen.getByRole('button', {
      name: 'Disable 2FA',
    })).toBeDisabled();

    expect(disableTwoFactor).not.toHaveBeenCalled();
  });

  test('successful disable refreshes account state', async () => {
    const onChange = jest.fn().mockResolvedValue();

    disableTwoFactor.mockResolvedValueOnce(true);

    render(
      <TwoFASection
        user={{ twoFactorEnabled: true }}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Disable two-factor authentication',
    }));

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', {
      name: 'Disable 2FA',
    }));

    await waitFor(() => {
      expect(disableTwoFactor).toHaveBeenCalledWith('123456');
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  test('failed disable keeps dialog open and shows error', async () => {
    disableTwoFactor.mockRejectedValueOnce(
      new Error('Invalid authenticator code')
    );

    render(
      <TwoFASection
        user={{ twoFactorEnabled: true }}
        onChange={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Disable two-factor authentication',
    }));

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', {
      name: 'Disable 2FA',
    }));

    expect(await screen.findByText('Invalid authenticator code'))
      .toBeInTheDocument();

    expect(screen.getByRole('dialog', {
      name: 'Disable two-factor authentication',
    })).toBeInTheDocument();
  });
  test('shows the protected-account policy returned by the server', async () => {
    const message = 'Two-factor authentication is required for active staff and protected founder accounts.';
    disableTwoFactor.mockRejectedValueOnce({ response: { status: 403, data: { error: message, reason: 'mfa_required' } } });
    const onChange = jest.fn();
    render(<TwoFASection user={{ twoFactorEnabled: true }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }));
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

});
