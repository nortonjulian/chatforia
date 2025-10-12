import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mocks ----
const postMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...a) => postMock(...a) },
}));

// Minimal Mantine stubs
jest.mock('@mantine/core', () => {
  const React = require('react');

  const Group = ({ children, ...rest }) => <div data-testid="group" {...rest}>{children}</div>;

  const TextInput = ({ label, value, onChange, placeholder, ...rest }) => (
    <label data-testid="textinput" {...rest}>
      {label}
      <input
        aria-label={label}
        placeholder={placeholder || ''}
        value={value ?? ''}
        onChange={(e) => onChange?.(e)}
      />
    </label>
  );

  const Button = ({ children, onClick, disabled, ...rest }) => (
    <button data-testid="button" onClick={onClick} disabled={!!disabled} {...rest}>
      {children}
    </button>
  );

  return { __esModule: true, Button, Group, TextInput };
});

// SUT
import AliasDialer from './AliasDealer';

describe('AliasDialer', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  test('renders input and disabled button initially', () => {
    render(<AliasDialer />);

    const input = screen.getByLabelText(/Call \(E\.164\)/i);
    const button = screen.getByTestId('button');

    expect(input).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/Place Call \(alias\)/i);
  });

  test('enables button when a value is entered and posts on click', async () => {
    render(<AliasDialer />);

    const input = screen.getByLabelText(/Call \(E\.164\)/i);
    const button = screen.getByTestId('button');

    // Enter a number
    fireEvent.change(input, { target: { value: '+15551234567' } });
    expect(button).not.toBeDisabled();

    // Click to place call
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/voice/call', { to: '+15551234567' });
    });
  });

  test('does not post when empty (button disabled)', () => {
    render(<AliasDialer />);
    fireEvent.click(screen.getByTestId('button')); // still disabled
    expect(postMock).not.toHaveBeenCalled();
  });
});
