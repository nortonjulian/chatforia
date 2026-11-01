import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

import TwoFASetupModal from '../TwoFASetupModal';
import {
  setupTwoFactor,
  enableTwoFactor,
} from '@/api/twoFactor';

jest.mock('@/api/twoFactor', () => ({
  setupTwoFactor: jest.fn(),
  enableTwoFactor: jest.fn(),
}));

jest.mock('@mantine/core', () => {
  const React = require('react');

  const Modal = ({ opened, onClose, title, children }) =>
    opened ? (
      <section role="dialog" aria-label={title}>
        <button
          type="button"
          aria-label="Close modal"
          onClick={onClose}
        >
          Close modal
        </button>
        {children}
      </section>
    ) : null;

  const Image = ({ src, alt }) => <img src={src} alt={alt} />;

  const TextInput = ({ label, value, onChange, disabled }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  );

  const Button = ({ children, onClick, disabled, loading }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
    >
      {children}
    </button>
  );

  const Checkbox = ({ label, checked, onChange }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
      />
      {label}
    </label>
  );

  const Stack = ({ children }) => <div>{children}</div>;
  const Code = ({ children }) => <code>{children}</code>;
  const Text = ({ children }) => <p>{children}</p>;
  const Alert = ({ children }) => <div role="alert">{children}</div>;

  return {
    Modal,
    Image,
    TextInput,
    Button,
    Checkbox,
    Stack,
    Code,
    Text,
    Alert,
  };
});

const setupResult = {
  qrDataUrl: 'data:image/png;base64,example',
  tmpSecret: 'TEST-SECRET',
};

beforeEach(() => {
  jest.clearAllMocks();
  setupTwoFactor.mockResolvedValue(setupResult);
});

afterEach(cleanup);

async function openSetup(onClose = jest.fn()) {
  render(<TwoFASetupModal opened onClose={onClose} />);

  await screen.findByAltText('Authenticator setup QR code');

  return onClose;
}

async function completeEnrollment() {
  await openSetup();

  fireEvent.change(screen.getByLabelText('Authenticator code'), {
    target: { value: '123456' },
  });

  enableTwoFactor.mockResolvedValueOnce({
    backupCodes: ['TEST-CODE-ONE', 'TEST-CODE-TWO'],
  });

  fireEvent.click(screen.getByRole('button', { name: 'Enable 2FA' }));

  await screen.findByText('TEST-CODE-ONE');
}

describe('TwoFASetupModal', () => {
  test('does not start enrollment while closed', () => {
    render(<TwoFASetupModal opened={false} onClose={jest.fn()} />);

    expect(setupTwoFactor).not.toHaveBeenCalled();
  });

  test('opens enrollment and displays authenticator QR code', async () => {
    await openSetup();

    expect(setupTwoFactor).toHaveBeenCalledTimes(1);

    expect(screen.getByAltText('Authenticator setup QR code'))
      .toHaveAttribute('src', setupResult.qrDataUrl);
  });

  test('enables MFA and displays recovery codes', async () => {
    await completeEnrollment();

    expect(enableTwoFactor).toHaveBeenCalledWith(
      'TEST-SECRET',
      '123456'
    );

    expect(screen.getByText('TEST-CODE-TWO'))
      .toBeInTheDocument();
  });

  test('does not submit invalid authenticator codes', async () => {
    await openSetup();

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '12345' },
    });

    expect(screen.getByRole('button', { name: 'Enable 2FA' }))
      .toBeDisabled();

    expect(enableTwoFactor).not.toHaveBeenCalled();
  });

  test('shows enrollment setup failures', async () => {
    setupTwoFactor.mockRejectedValueOnce(
      new Error('Enrollment unavailable')
    );

    render(<TwoFASetupModal opened onClose={jest.fn()} />);

    expect(await screen.findByText('Enrollment unavailable'))
      .toBeInTheDocument();

    expect(enableTwoFactor).not.toHaveBeenCalled();
  });

  test('shows verification failures without claiming success', async () => {
    await openSetup();

    enableTwoFactor.mockRejectedValueOnce(
      new Error('Invalid verification code')
    );

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Enable 2FA' }));

    expect(await screen.findByText('Invalid verification code'))
      .toBeInTheDocument();

    expect(screen.queryByText('TEST-CODE-ONE'))
      .not.toBeInTheDocument();
  });

  test('requires recovery-code acknowledgment before Done', async () => {
    await completeEnrollment();

    expect(screen.getByRole('button', { name: 'Done' }))
      .toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'I have saved my recovery codes in a safe place',
    }));

    expect(screen.getByRole('button', { name: 'Done' }))
      .toBeEnabled();
  });

  test('prevents closing before recovery-code acknowledgment', async () => {
    await completeEnrollment();

    fireEvent.click(screen.getByRole('button', {
      name: 'Close modal',
    }));

    expect(screen.getByText('TEST-CODE-ONE'))
      .toBeInTheDocument();
  });

  test('notifies parent only after successful acknowledged enrollment', async () => {
    const onClose = jest.fn();

    setupTwoFactor.mockResolvedValueOnce(setupResult);

    render(<TwoFASetupModal opened onClose={onClose} />);

    await screen.findByAltText('Authenticator setup QR code');

    enableTwoFactor.mockResolvedValueOnce({
      backupCodes: ['TEST-CODE-ONE'],
    });

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Enable 2FA' }));

    await screen.findByText('TEST-CODE-ONE');

    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'I have saved my recovery codes in a safe place',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledWith(true);
  });

  test('reopening starts a fresh setup', async () => {
    const onClose = jest.fn();

    const { rerender } = render(
      <TwoFASetupModal opened={false} onClose={onClose} />
    );

    rerender(<TwoFASetupModal opened onClose={onClose} />);

    await screen.findByAltText('Authenticator setup QR code');

    expect(setupTwoFactor).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', {
      name: 'Close modal',
    }));

    expect(onClose).toHaveBeenCalledWith(false);
  });
});
