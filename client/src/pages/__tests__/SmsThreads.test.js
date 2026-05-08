import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mantine minimal stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');

  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>
      {children}
    </div>
  );

  const Button = ({ children, onClick, disabled, ...rest }) => (
    <button onClick={onClick} disabled={!!disabled} {...rest}>
      {children}
    </button>
  );

  const TextInput = ({
    label,
    value,
    onChange,
    placeholder,
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={onChange}
      />
    </label>
  );

  return {
    __esModule: true,
    Button,
    Group: passthru('group'),
    Stack: passthru('stack'),
    TextInput,
    Title: passthru('title'),
  };
});

// ---- Router stubs ----
jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ to, children, ...rest }) => (
    <a data-testid="link" href={to} {...rest}>
      {children}
    </a>
  ),
}));

// ---- axios client ----
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
  },
}));

// ---- Child component (AliasDialer) ----
jest.mock('@/pages/AliasDialer.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="alias-dialer">alias</div>,
}));

// ---- SUT ----
import SmsThreads from '@/pages/SmsThreads.jsx';

describe('SmsThreads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads threads on mount and renders links', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        items: [
          { id: 't1', contactPhone: '+15551230001' },
          { id: 't2', contactPhone: '+15551230002' },
        ],
      },
    });

    render(<SmsThreads />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/sms/threads');
    });

    const links = await screen.findAllByTestId('link');

    expect(links).toHaveLength(2);

    expect(links[0]).toHaveAttribute('href', '/sms/t1');
    expect(links[0]).toHaveTextContent('+15551230001');

    expect(links[1]).toHaveAttribute('href', '/sms/t2');
    expect(links[1]).toHaveTextContent('+15551230002');

    expect(screen.getByTestId('alias-dialer')).toBeInTheDocument();
  });

  test('send button disabled until both To and Message are non-empty (message trimmed)', async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [] },
    });

    render(<SmsThreads />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });

    const toInput = screen.getByLabelText(/To \(E\.164\)/i);
    const msgInput = screen.getByLabelText(/Message/i);
    const sendBtn = screen.getByRole('button', { name: /send/i });

    // Initially disabled
    expect(sendBtn).toBeDisabled();

    // Only "to" filled -> still disabled
    fireEvent.change(toInput, {
      target: { value: '+15551234567' },
    });

    expect(sendBtn).toBeDisabled();

    // Message whitespace -> still disabled
    fireEvent.change(msgInput, {
      target: { value: '   ' },
    });

    expect(sendBtn).toBeDisabled();

    // Non-empty message -> enabled
    fireEvent.change(msgInput, {
      target: { value: 'Hello' },
    });

    expect(sendBtn).not.toBeDisabled();
  });

  test('clicking Send posts to /sms/send and clears only the message input', async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [] },
    });

    mockPost.mockResolvedValueOnce({
      data: { ok: true },
    });

    render(<SmsThreads />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });

    const toInput = screen.getByLabelText(/To \(E\.164\)/i);
    const msgInput = screen.getByLabelText(/Message/i);
    const sendBtn = screen.getByRole('button', { name: /send/i });

    fireEvent.change(toInput, {
      target: { value: '+15559876543' },
    });

    fireEvent.change(msgInput, {
      target: { value: ' Hi there ' },
    });

    fireEvent.click(sendBtn);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/sms/send', {
        to: '+15559876543',
        body: ' Hi there ',
      })
    );

    // Body cleared; "to" unchanged
    expect(msgInput).toHaveValue('');
    expect(toInput).toHaveValue('+15559876543');

    // Button disabled again (empty body)
    expect(sendBtn).toBeDisabled();
  });

  test('handles empty fetch results gracefully', async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [] },
    });

    render(<SmsThreads />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('link')).toBeNull();
  });
});