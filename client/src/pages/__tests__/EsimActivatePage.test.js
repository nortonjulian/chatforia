import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@/api/esim', () => ({
  reserveEsim: vi.fn(),
}));

// Mock qrcode so we control the data URL
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn() },
  toDataURL: vi.fn(), // some bundlers import the named fn
}));

import { reserveEsim } from '@/api/esim';
import QRCode from 'qrcode';
import EsimActivatePage from './EsimActivatePage.jsx';

describe('EsimActivatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading and button', () => {
    render(<EsimActivatePage />);
    expect(screen.getByText(/Activate your eSIM/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate QR/i })).toBeInTheDocument();
  });

  it('requests reservation for default region US and shows QR + details', async () => {
    reserveEsim.mockResolvedValueOnce({
      smdp: 'sm-dp.example.com',
      activationCode: 'ABC123',
      lpaUri: 'LPA:1$sm-dp.example.com$ABC123',
      qrPayload: 'LPA:1$sm-dp.example.com$ABC123',
      iccidHint: '8901*********',
    });
    // ensure QR library returns a deterministic data URL
    (QRCode.toDataURL || QRCode.default.toDataURL).mockResolvedValueOnce(
      'data:image/png;base64,QRMOCK'
    );

    render(<EsimActivatePage />);

    fireEvent.click(screen.getByRole('button', { name: /Generate QR/i }));

    await waitFor(() => {
      // Details appear
      expect(screen.getByText(/SM-DP\+:/)).toBeInTheDocument();
      expect(screen.getByText('sm-dp.example.com')).toBeInTheDocument();
      expect(screen.getByText(/Activation code:/)).toBeInTheDocument();
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    // QR image is rendered with mocked data URL
    const img = await screen.findByRole('img', { name: /eSIM QR/i });
    expect(img).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,QRMOCK'));

    // API was called with default region "US"
    expect(reserveEsim).toHaveBeenCalledWith('US');
  });

  it('passes selected region to API (e.g., EU)', async () => {
    reserveEsim.mockResolvedValueOnce({
      smdp: 'sm-dp.eu',
      activationCode: 'EU777',
      lpaUri: 'LPA:1$sm-dp.eu$EU777',
      qrPayload: 'LPA:1$sm-dp.eu$EU777',
    });
    (QRCode.toDataURL || QRCode.default.toDataURL).mockResolvedValueOnce(
      'data:image/png;base64,EUQR'
    );

    render(<EsimActivatePage />);

    fireEvent.change(screen.getByDisplayValue('US'), { target: { value: 'EU' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate QR/i }));

    await screen.findByText('sm-dp.eu');
    expect(reserveEsim).toHaveBeenCalledWith('EU');
  });

  it('shows error UI when reservation fails', async () => {
    reserveEsim.mockRejectedValueOnce(new Error('Backend exploded'));
    render(<EsimActivatePage />);

    fireEvent.click(screen.getByRole('button', { name: /Generate QR/i }));

    await waitFor(() => {
      expect(screen.getByText(/Backend exploded/i)).toBeInTheDocument();
    });
  });

  it('shows "Generating QR…" placeholder before QR is rendered', async () => {
    reserveEsim.mockResolvedValueOnce({
      smdp: 'sm-dp.example.com',
      activationCode: 'ABC123',
      lpaUri: 'LPA:1$sm-dp.example.com$ABC123',
    });

    // Delay QR generation to let placeholder render first
    const toDataURL = (QRCode.toDataURL || QRCode.default.toDataURL);
    toDataURL.mockImplementationOnce(
      () => new Promise(resolve => setTimeout(() => resolve('data:image/png;base64,SLOW'), 30))
    );

    render(<EsimActivatePage />);
    fireEvent.click(screen.getByRole('button', { name: /Generate QR/i }));

    // Placeholder shows up
    expect(await screen.findByText(/Generating QR…/i)).toBeInTheDocument();

    // Then QR image appears
    const img = await screen.findByRole('img', { name: /eSIM QR/i });
    expect(img).toHaveAttribute('src', expect.stringContaining('SLOW'));
  });
});
