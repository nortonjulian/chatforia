import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/* ---------------- Mantine minimal stubs ---------------- */
jest.mock('@mantine/core', () => {
  const React = require('react');
  const passthru = (tid) => ({ children, ...props }) => (
    <div data-testid={tid} {...props}>{children}</div>
  );

  const Button = ({ children, onClick, disabled, ...rest }) => (
    <button onClick={onClick} disabled={!!disabled} {...rest}>{children}</button>
  );
  const TextInput = ({ value, onChange, placeholder, ...rest }) => (
    <input
      aria-label={placeholder || 'input'}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={onChange}
      {...rest}
    />
  );
  const Text = ({ children, ...rest }) => <div {...rest}>{children}</div>;

  return {
    __esModule: true,
    Button,
    Group: passthru('group'),
    Stack: passthru('stack'),
    TextInput,
    Title: passthru('title'),
    Text,
  };
});

/* ---------------- Router params ---------------- */
global.__mockRouteId = 't1';
jest.mock('react-router-dom', () => {
  const React = require('react');
  return {
    __esModule: true,
    useParams: () => ({ id: global.__mockRouteId }),
    Link: ({ to, children, ...p }) => <a href={to} {...p}>{children}</a>,
  };
});

/* ---------------- axios client ---------------- */
// Use names prefixed with "mock" so Jest allows them in the mock factory
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    post: (...a) => mockPost(...a),
  },
}));

/* ---------------- SUT ---------------- */
import SmsThreadView from '../SmsThreadView';

describe('SmsThreadView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.__mockRouteId = 't1';
  });

  test('loads thread on mount and renders messages (inbound and outbound)', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        id: 't1',
        contactPhone: '+15551230001',
        messages: [
          { id: 'm1', direction: 'in', fromNumber: '+15551230001', body: 'Hi there' },
          { id: 'm2', direction: 'out', fromNumber: '+15550000000', body: 'Hello!' },
        ],
      },
    });

    render(<SmsThreadView />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/sms/threads/t1');
      expect(screen.getByText(/Chat with \+15551230001/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/\+15551230001:/)).toBeInTheDocument();
    expect(screen.getByText(/Hi there/)).toBeInTheDocument();

    expect(screen.getByText(/^You:/)).toBeInTheDocument();
    expect(screen.getByText(/Hello!/)).toBeInTheDocument();
  });

  test('Send button disabled until trimmed body is non-empty', async () => {
    mockGet.mockResolvedValueOnce({
      data: { id: 't1', contactPhone: '+1555123', messages: [] },
    });

    render(<SmsThreadView />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/Reply…/i);
    const sendBtn = screen.getByRole('button', { name: /send/i });

    expect(sendBtn).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(sendBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(sendBtn).not.toBeDisabled();
  });

  test('sending posts to /sms/send, clears input, and reloads thread with new message', async () => {
    // First load
    mockGet.mockResolvedValueOnce({
      data: {
        id: 't1',
        contactPhone: '+15551230001',
        messages: [{ id: 'm1', direction: 'in', fromNumber: '+1555', body: 'Ping' }],
      },
    });
    // After send -> reload returns new list including our sent one
    mockGet.mockResolvedValueOnce({
      data: {
        id: 't1',
        contactPhone: '+15551230001',
        messages: [
          { id: 'm1', direction: 'in', fromNumber: '+1555', body: 'Ping' },
          { id: 'm2', direction: 'out', fromNumber: 'me', body: 'Pong' },
        ],
      },
    });
    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    render(<SmsThreadView />);

    await waitFor(() => screen.getByText(/Chat with \+15551230001/i));

    const input = screen.getByPlaceholderText(/Reply…/i);
    const sendBtn = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'Pong' } });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/sms/send', {
        to: '+15551230001',
        body: 'Pong',
      });
    });

    expect(input).toHaveValue('');

    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/sms/threads/t1'));

    expect(screen.getByText(/^You:/)).toBeInTheDocument();
    expect(screen.getByText('Pong')).toBeInTheDocument();
  });

  test('uses route param id in request (different id)', async () => {
    global.__mockRouteId = 'abc999';
    mockGet.mockResolvedValueOnce({
      data: { id: 'abc999', contactPhone: '+18885550000', messages: [] },
    });

    render(<SmsThreadView />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/sms/threads/abc999');
      expect(screen.getByText(/Chat with \+18885550000/i)).toBeInTheDocument();
    });
  });
});
