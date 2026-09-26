import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/api/esim', () => ({
  __esModule: true,
  getMyEsim: jest.fn(),
}));

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
  toDataURL: jest.fn(),
}));

import { getMyEsim } from '@/api/esim';
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

  it('loads an existing eSIM and shows QR plus activation details', async () => {
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

    QRCode.toDataURL.mockResolvedValueOnce(
      'data:image/png;base64,QRMOCK'
    );

    render(<EsimActivatePage />);

    expect(
      await screen.findByText('sm-dp.example.com')
    ).toBeInTheDocument();

    expect(screen.getByText('ABC123')).toBeInTheDocument();

    const img = await screen.findByRole('img', {
      name: /eSIM QR/i,
    });

    expect(img).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/png;base64,QRMOCK')
    );

    expect(getMyEsim).toHaveBeenCalledTimes(1);
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      'LPA:1$sm-dp.example.com$ABC123',
      expect.objectContaining({
        errorCorrectionLevel: 'M',
      })
    );
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
