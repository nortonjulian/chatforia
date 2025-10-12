import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- Mantine minimal stubs ----
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Button = ({ children, onClick, disabled, ...rest }) => (
    <button onClick={onClick} disabled={!!disabled} {...rest}>{children}</button>
  );
  const TextInput = ({ label, value, onChange, placeholder }) => (
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
    <a data-testid="link" href={to} {...rest}>{children}</a>
  ),
}));

// ---- axios client ----
const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => getMock(...a),
    post: (...a) => postMock(...a),
  },
}));

// ---- Child component (AliasDialer) ----
jest.mock('@/pages/AliasDialer.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="alias-dialer">alias</div>,
}));

// ---- SUT ----
import SmsThreads from './SmsThreads';

describe('SmsThreads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads threads on mount and renders links', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [
          { id: 't1', contactPhone: '+15551230001' },
          { id: 't2', contactPhone: '+15551230002' },
        ],
      },
    });

    render(<SmsThreads />);

    // GET called
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/sms/threads'));

    // Links rendered with correct hrefs and text
    const links = screen.getAllByTestId('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/sms/threads/t1');
    expect(links[0]).toHaveTextContent('Thread with +15551230001');
    expect(links[1]).toHaveAttribute('href', '/sms/threads/t2');
    expect(links[1]).toHaveTextContent('Thread with +15551230002');

    // AliasDialer present
    expect(screen.getByTestId('alias-dialer')).toBeInTheDocument();
  });

  test('send button disabled until both To and Message are non-empty (message trimmed)', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [] } });
    render(<SmsThreads />);

    const toInput = screen.getByLabelText(/To \(E\.164\)/i);
    const msgInput = screen.getByLabelText(/Message/i);
    const sendBtn = screen.getByRole('button', { name: /send/i });

    // Initially disabled
    expect(sendBtn).toBeDisabled();

    // Only "to" filled -> still disabled
    fireEvent.change(toInput, { target: { value: '+15551234567' } });
    expect(sendBtn).toBeDisabled();

    // Message whitespace -> still disabled
    fireEvent.change(msgInput, { target: { value: '   ' } });
    expect(sendBtn).toBeDisabled();

    // Non-empty message -> enabled
    fireEvent.change(msgInput, { target: { value: 'Hello' } });
    expect(sendBtn).not.toBeDisabled();
  });

  test('clicking Send posts to /sms/send and clears only the message input', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [] } });
    postMock.mockResolvedValueOnce({ data: { ok: true } });

    render(<SmsThreads />);

    const toInput = screen.getByLabelText(/To \(E\.164\)/i);
    const msgInput = screen.getByLabelText(/Message/i);
    const sendBtn = screen.getByRole('button', { name: /send/i });

    fireEvent.change(toInput, { target: { value: '+15559876543' } });
    fireEvent.change(msgInput, { target: { value: ' Hi there ' } });

    fireEvent.click(sendBtn);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/sms/send', {
        to: '+15559876543',
        body: ' Hi there ', // component sends as-is; disable checks only trim for button state
      })
    );

    // Body cleared; "to" unchanged
    expect(msgInput).toHaveValue('');
    expect(toInput).toHaveValue('+15559876543');

    // Button now disabled again (no message)
    expect(sendBtn).toBeDisabled();
  });

  test('handles empty fetch results gracefully', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [] } });
    render(<SmsThreads />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    // No links rendered
    expect(screen.queryByTestId('link')).toBeNull();
  });
});
