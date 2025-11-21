import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslation, Trans } from 'react-i18next';
import { reserveEsim } from '@/api/esim';

export default function EsimActivatePage() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [provision, setProvision] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [error, setError] = useState(null);

  // Fallback list (client-side) in case /esim/regions isn't available.
  const [regions, setRegions] = useState([
    'US', 'EU', 'UK', 'CA', 'AU', 'JP', 'MX', 'BR', 'IN', 'ZA', 'SG', 'HK', 'KR', 'AE',
  ]);

  const [region, setRegion] = useState('US');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/esim/regions', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.regions) && data.regions.length) {
          setRegions(data.regions);
          if (!data.regions.includes(region)) setRegion(data.regions[0]);
        }
      } catch {
        // silently keep fallback regions
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canShow = provision?.smdp && provision?.activationCode;
  const qrPayload = provision?.qrPayload || provision?.lpaUri || null;

  async function handleReserve() {
    setLoading(true);
    setError(null);
    setProvision(null);
    setQrDataUrl(null);
    try {
      const data = await reserveEsim(region);
      setProvision(data);
    } catch (e) {
      setError(e?.message || t('esim.errorReserve', 'Failed to reserve eSIM'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!qrPayload) return;
      try {
        const url = await QRCode.toDataURL(qrPayload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          scale: 6,
        });
        if (!cancelled) setQrDataUrl(url);
      } catch (e) {
        console.error('QR generation failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qrPayload]);

  const REGION_NAME_FALLBACKS = {
    US: 'United States',
    EU: 'European Union',
    UK: 'United Kingdom',
    CA: 'Canada',
    AU: 'Australia',
    JP: 'Japan',
    MX: 'Mexico',
    BR: 'Brazil',
    IN: 'India',
    ZA: 'South Africa',
    SG: 'Singapore',
    HK: 'Hong Kong',
    KR: 'South Korea',
    AE: 'United Arab Emirates',
  };

  const regionLabel = (r) =>
    t(`esim.regions.${r}`, REGION_NAME_FALLBACKS[r] || r);

  const instructions = useMemo(
    () => (
      <ol className="list-decimal pl-5 text-sm space-y-1">
        <li>
          <Trans i18nKey="esim.instructions.step1">
            On your phone, open <b>Settings → Cellular</b> (iOS) or{' '}
            <b>Network &amp; Internet</b> (Android).
          </Trans>
        </li>
        <li>
          <Trans i18nKey="esim.instructions.step2">
            Choose <b>Add eSIM</b> / <b>Download a SIM</b>, then{' '}
            <b>Use QR code</b>.
          </Trans>
        </li>
        <li>
          <Trans i18nKey="esim.instructions.step3">
            Scan the code below. If that fails, enter the details manually.
          </Trans>
        </li>
      </ol>
    ),
    [t],
  );

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        {t('esim.title', 'Activate your eSIM')}
      </h1>

      <div className="flex items-center gap-2">
        <label className="text-sm">
          {t('esim.regionLabel', 'Region')}
        </label>
        <select
          className="border rounded px-2 py-1 text-sm"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        >
          {regions.map((r) => (
            <option key={r} value={r}>
              {regionLabel(r)}
            </option>
          ))}
        </select>

        <button
          onClick={handleReserve}
          disabled={loading}
          className="ml-auto px-3 py-1.5 rounded bg-black text-white disabled:opacity-60"
        >
          {loading
            ? t('esim.ctaReserving', 'Reserving…')
            : t('esim.ctaGenerate', 'Generate QR')}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-sm">
          {error}
        </div>
      )}

      {provision && (
        <div className="space-y-4">
          {instructions}

          {qrDataUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img
                src={qrDataUrl}
                alt="eSIM QR"
                className="border rounded-lg p-2 w-64 h-64 bg-white"
              />
              <a
                href={qrDataUrl}
                download="chatforia-esim-qr.png"
                className="text-sm underline"
              >
                {t('esim.downloadPng', 'Download QR as PNG')}
              </a>
            </div>
          ) : (
            <div className="p-4 border rounded">
              {t('esim.generatingQr', 'Generating QR…')}
            </div>
          )}

          <div className="bg-gray-50 p-3 rounded border text-sm">
            <div>
              <b>{t('esim.smdp', 'SM-DP+')}:</b> {provision.smdp || '—'}
            </div>
            <div>
              <b>{t('esim.activationCode', 'Activation code')}:</b>{' '}
              {provision.activationCode || '—'}
            </div>
            {provision.lpaUri && (
              <div className="mt-1 text-xs break-all">
                <b>{t('esim.lpaUri', 'LPA URI')}:</b> {provision.lpaUri}
              </div>
            )}
            {provision.iccidHint && (
              <div className="mt-1 text-xs">
                <b>{t('esim.iccidHint', 'ICCID hint')}:</b>{' '}
                {provision.iccidHint}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500">
            {t(
              'esim.secrecyNote',
              'Keep this info secret. Treat it like a password until activation completes.',
            )}
          </p>
        </div>
      )}
    </div>
  );
}
