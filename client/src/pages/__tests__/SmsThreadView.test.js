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

// ---- Router params ----
let routeId = 't1';
jest.mock('react-router-dom', () => ({
  __esModule: true,
  useParams: () => ({ id: routeId }),
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

// ---- SUT ----
import SmsThreadView from './SmsThreadView';

describe('SmsThreadView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routeId = 't1';
  });

  test('loads thread on mount and renders messages (inbound and outbound)', async () => {
    getMock.mockResolvedValueOnce({
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
      expect(getMock).toHaveBeenCalledWith('/sms/threads/t1');
      expect(screen.getByText(/Chat with \+15551230001/i)).toBeInTheDocument();
    });

    // Inbound message label uses fromNumber
    expect(screen.getByText(/\+15551230001:/)).toBeInTheDocument();
    expect(screen.getByText(/Hi there/)).toBeInTheDocument();

    // Outbound message label uses "You"
    expect(screen.getByText(/^You:/)).toBeInTheDocument();
    expect(screen.getByText(/Hello!/)).toBeInTheDocument();
  });

  test('Send button disabled until trimmed body is non-empty', async () => {
    getMock.mockResolvedValueOnce({
      data: { id: 't1', contactPhone: '+1555123', messages: [] },
    });

    render(<SmsThreadView />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());

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
    getMock.mockResolvedValueOnce({
      data: {
        id: 't1',
        contactPhone: '+15551230001',
        messages: [{ id: 'm1', direction: 'in', fromNumber: '+1555', body: 'Ping' }],
      },
    });
    // After send -> reload returns new list including our sent one
    getMock.mockResolvedValueOnce({
      data: {
        id: 't1',
        contactPhone: '+15551230001',
        messages: [
          { id: 'm1', direction: 'in', fromNumber: '+1555', body: 'Ping' },
          { id: 'm2', direction: 'out', fromNumber: 'me', body: 'Pong' },
        ],
      },
    });
    postMock.mockResolvedValueOnce({ data: { ok: true } });

    render(<SmsThreadView />);

    await waitFor(() => screen.getByText(/Chat with \+15551230001/i));

    const input = screen.getByPlaceholderText(/Reply…/i);
    const sendBtn = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'Pong' } });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/sms/send', {
        to: '+15551230001',
        body: 'Pong',
      });
    });

    // Input cleared
    expect(input).toHaveValue('');

    // Reload called again
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/sms/threads/t1'));

    // New outbound message rendered
    expect(screen.getByText(/^You:/)).toBeInTheDocument();
    expect(screen.getByText('Pong')).toBeInTheDocument();
  });

  test('uses route param id in request (different id)', async () => {
    routeId = 'abc999';
    getMock.mockResolvedValueOnce({
      data: { id: 'abc999', contactPhone: '+18885550000', messages: [] },
    });

    render(<SmsThreadView />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/sms/threads/abc999');
      expect(screen.getByText(/Chat with \+18885550000/i)).toBeInTheDocument();
    });
  });
});
