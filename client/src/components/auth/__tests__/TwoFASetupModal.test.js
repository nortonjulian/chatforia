import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TwoFASetupModal from '../TwoFASetupModal';


// ---------- Mocks ----------

// Mantine stand-ins
jest.mock('@mantine/core', () => {
  const React = require('react');
  const Modal = ({ opened, onClose, title, children }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        <button aria-label="close-modal" onClick={onClose} style={{ display: 'none' }} />
        {children}
      </div>
    ) : null;

  const Image = ({ src, alt, ...p }) => <img alt={alt} src={src} {...p} />;
  const TextInput = ({ label, value, onChange }) => (
    <label>
      {label}
      <input aria-label={label} value={value} onChange={onChange} />
    </label>
  );
  const Button = ({ children, onClick, ...p }) => (
    <button type="button" onClick={onClick} {...p}>{children}</button>
  );
  const Stack = ({ children, ...p }) => <div {...p}>{children}</div>;
  const Code = ({ children, ...p }) => <code {...p}>{children}</code>;

  return { Modal, Image, TextInput, Button, Stack, Code };
});

// Global fetch
const fetchMock = jest.fn();
global.fetch = fetchMock;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('TwoFASetupModal', () => {
  test('does not fetch when closed; fetches setup and shows QR when opened', async () => {
    // Start closed: no call
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { rerender } = render(<TwoFASetupModal opened={false} onClose={jest.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();

    // Open: should POST /auth/2fa/setup and render QR
    const setupResp = {
      qrDataUrl: 'data:image/png;base64,abc',
      tmpSecret: 'TMP-123',
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => setupResp });
    rerender(<TwoFASetupModal opened={true} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/auth/2fa/setup', { method: 'POST' });
    });
    const img = await screen.findByAltText(/scan qr/i);
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc');
  });

  test('enable posts with tmpSecret and code, then shows backup codes on ok=true', async () => {
    // 1) Setup call to get tmpSecret/QR
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ qrDataUrl: 'data:image/png;base64,foo', tmpSecret: 'TMP-XYZ' }),
    });

    render(<TwoFASetupModal opened onClose={jest.fn()} />);

    await screen.findByAltText(/scan qr/i);

    // 2) Type code
    fireEvent.change(screen.getByLabelText(/enter the 6-digit code/i), {
      target: { value: '123456' },
    });

    // 3) Enable -> responds with ok + backupCodes
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, backupCodes: ['A1B2-C3D4', 'E5F6-G7H8'] }),
    });

    fireEvent.click(screen.getByRole('button', { name: /enable/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmpSecret: 'TMP-XYZ', code: '123456' }),
      });
    });

    // Backup codes now visible
    expect(await screen.findByText('A1B2-C3D4')).toBeInTheDocument();
    expect(await screen.findByText('E5F6-G7H8')).toBeInTheDocument();
    // Done button visible
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
  });

  test('enable non-ok response does not show backup codes', async () => {
    // Setup success
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ qrDataUrl: 'data:image/png;base64,x', tmpSecret: 'TMP-1' }),
    });

    render(<TwoFASetupModal opened onClose={jest.fn()} />);

    await screen.findByAltText(/scan qr/i);
    fireEvent.change(screen.getByLabelText(/enter the 6-digit code/i), {
      target: { value: '000000' },
    });

    // enable -> ok: false
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false }),
    });

    fireEvent.click(screen.getByRole('button', { name: /enable/i }));

    // Should remain on input UI (no backup codes)
    await waitFor(() => {
      expect(screen.queryByText(/save these backup codes/i)).not.toBeInTheDocument();
    });
  });

  test('"Done" calls onClose when backup codes are shown', async () => {
    const onClose = jest.fn();
    // Setup + enable returning codes
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ qrDataUrl: 'data:image/png;base64,y', tmpSecret: 'TMP-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, backupCodes: ['Z1Z1-Z1Z1'] }),
      });

    render(<TwoFASetupModal opened onClose={onClose} />);

    await screen.findByAltText(/scan qr/i);
    fireEvent.change(screen.getByLabelText(/enter the 6-digit code/i), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));

    await screen.findByText('Z1Z1-Z1Z1');

    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('re-open triggers setup fetch again', async () => {
    const { rerender } = render(<TwoFASetupModal opened={false} onClose={jest.fn()} />);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ qrDataUrl: 'data:image/png;base64,first', tmpSecret: 'TMP-A' }),
    });
    rerender(<TwoFASetupModal opened onClose={jest.fn()} />);
    await screen.findByAltText(/scan qr/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ qrDataUrl: 'data:image/png;base64,second', tmpSecret: 'TMP-B' }),
    });
    render(<TwoFASetupModal opened onClose={jest.fn()} />);
    await screen.findByAltText(/scan qr/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
