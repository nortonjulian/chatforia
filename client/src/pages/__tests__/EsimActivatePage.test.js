import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/api/esim', () => ({
  __esModule: true,
  getMyEsim: jest.fn(),
  activateEsim: jest.fn(),
}));

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
  toDataURL: jest.fn(),
}));

import { getMyEsim, activateEsim } from '@/api/esim';
import QRCode from 'qrcode';
import EsimActivatePage from '../EsimActivatePage.jsx';

describe('EsimActivatePage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('shows purchase guidance when no eSIM has been allocated', async () => {
    getMyEsim.mockResolvedValueOnce({
      subscriber: null,
    });

    render(<EsimActivatePage />);

    expect(
      screen.getByText(/Activate your eSIM/i)
    ).toBeInTheDocument();

    expect(
      await screen.findByText(/No eSIM has been allocated yet/i)
    ).toBeInTheDocument();

    expect(
      screen.getByText(/Purchase a mobile data plan/i)
    ).toBeInTheDocument();
  });

  it('hides provisioning credentials once the eSIM is ACTIVE', async () => {
    getMyEsim.mockResolvedValueOnce({
      subscriber: {
        status: 'ACTIVE',
        smdp: 'sm-dp.example.com',
        activationCode: 'ABC123',
        lpaUri: 'LPA:1$sm-dp.example.com$ABC123',
        qrPayload: 'LPA:1$sm-dp.example.com$ABC123',
        iccidHint: '8901*********',
      },
    });

    render(<EsimActivatePage />);

    expect(
      await screen.findByText(/Status.*ACTIVE/i)
    ).toBeInTheDocument();

    expect(
      screen.queryByText('sm-dp.example.com')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText('ABC123')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText('LPA:1$sm-dp.example.com$ABC123')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('img', { name: /eSIM QR/i })
    ).not.toBeInTheDocument();

    expect(getMyEsim).toHaveBeenCalledTimes(1);
    expect(QRCode.toDataURL).not.toHaveBeenCalled();
  });

  it('builds the QR payload from SM-DP+ and activation code', async () => {
    getMyEsim.mockResolvedValueOnce({
      subscriber: {
        smdp: 'sm-dp.example.com',
        activationCode: 'ABC123',
      },
    });

    QRCode.toDataURL.mockResolvedValueOnce(
      'data:image/png;base64,QRMOCK'
    );

    render(<EsimActivatePage />);

    await screen.findByRole('img', {
      name: /eSIM QR/i,
    });

    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      'LPA:1$sm-dp.example.com$ABC123',
      expect.any(Object)
    );
  });

  it('automatically checks activation when the saved eSIM is PROVISIONING', async () => {
    getMyEsim.mockResolvedValueOnce({
      subscriber: {
        id: 77,
        status: 'PROVISIONING',
        iccid: '8910300000059080801',
        providerProfileId: '8910300000059080801',
        activationCode: 'ABC123',
        smdp: 'sm-dp.example.com',
      },
    });

    activateEsim.mockResolvedValueOnce({
      ok: true,
      status: 'ACTIVE',
      activatedAt: '2026-10-13T20:00:00.000Z',
    });

    render(<EsimActivatePage />);

    await waitFor(() => {
      expect(activateEsim).toHaveBeenCalledWith({
        iccid: '8910300000059080801',
        activationCode: 'ABC123',
        providerProfileId: '8910300000059080801',
      });
    });

    expect(
      await screen.findByText(/ACTIVE/i)
    ).toBeInTheDocument();
  });

  it('keeps PROVISIONING and offers a manual activation recheck when Telna has not enabled the profile', async () => {
    getMyEsim.mockResolvedValueOnce({
      subscriber: {
        id: 77,
        status: 'PROVISIONING',
        iccid: '8910300000059080801',
        providerProfileId: '8910300000059080801',
        activationCode: 'ABC123',
        smdp: 'sm-dp.example.com',
      },
    });

    activateEsim.mockResolvedValueOnce({
      ok: false,
      status: 'PROVISIONING',
    });

    render(<EsimActivatePage />);

    expect(
      await screen.findByText(/PROVISIONING/i)
    ).toBeInTheDocument();

    expect(
      await screen.findByRole('button', {
        name: /check activation status/i,
      })
    ).toBeInTheDocument();
  });

  it('shows generating QR while QR creation is pending', async () => {
    let resolveQr;

    getMyEsim.mockResolvedValueOnce({
      subscriber: {
        smdp: 'sm-dp.example.com',
        activationCode: 'ABC123',
        qrPayload: 'LPA:1$sm-dp.example.com$ABC123',
      },
    });

    QRCode.toDataURL.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQr = resolve;
        })
    );

    render(<EsimActivatePage />);

    expect(
      await screen.findByText(/Generating QR/i)
    ).toBeInTheDocument();

    resolveQr('data:image/png;base64,SLOW');

    const img = await screen.findByRole('img', {
      name: /eSIM QR/i,
    });

    expect(img).toHaveAttribute(
      'src',
      expect.stringContaining('SLOW')
    );
  });
});
