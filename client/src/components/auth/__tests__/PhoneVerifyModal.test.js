import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhoneVerifyModal from '@/components/PhoneVerifyModal'; // update path if needed

// ---------- Mocks ----------

// Mantine components (simple stand-ins)
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Modal = ({ opened, onClose, title, children }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        <button aria-label="close-modal" onClick={() => onClose(false)} style={{ display: 'none' }} />
        <h2>{title}</h2>
        {children}
      </div>
    ) : null;

  const TextInput = ({ label, value, onChange, placeholder }) => (
    <label>
      {label}
      <input aria-label={label} placeholder={placeholder} value={value} onChange={onChange} />
    </label>
  );

  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );

  const Group = ({ children }) => <div>{children}</div>;

  return { Modal, TextInput, Button, Group };
});

// Global fetch mock
const fetchMock = jest.fn();
global.fetch = fetchMock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PhoneVerifyModal', () => {
  test('prefills phone, sends code, navigates to "sent", can change number back', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /start

    render(
      <PhoneVerifyModal
        opened
        onClose={jest.fn()}
        user={{ phoneNumber: '+15551234567' }}
      />
    );

    // Prefilled phone
    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(phoneInput).toHaveValue('+15551234567');

    // Send code
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/auth/phone/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '+15551234567' }),
      });
    });

    // Stage switched to "sent"
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();

    // Change number -> back to "enter"
    fireEvent.click(screen.getByRole('button', { name: /change number/i }));
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
  });

  test('verify posts code and closes with success only when ok=true', async () => {
    const onClose = jest.fn();

    // First, render and advance to "sent"
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /start
    render(<PhoneVerifyModal opened onClose={onClose} user={{ phoneNumber: '' }} />);

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: '+111' } });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // 1) verify -> ok: false => does NOT close
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false }) }); // /verify
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      });
    });
    expect(onClose).not.toHaveBeenCalled();

    // 2) verify -> ok: true => closes with true
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  test('closing modal via X calls onClose(false)', () => {
    const onClose = jest.fn();
    render(<PhoneVerifyModal opened onClose={onClose} user={{}} />);
    fireEvent.click(screen.getByLabelText('close-modal'));
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
