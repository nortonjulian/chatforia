import { useTranslation } from 'react-i18next';

// Telna Travel Data templates 21911604 (Europe) and 21911608 (Global).
const destinations = {
  europe: (
    'AL AD AT BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE ' +
    'XK LV LI LT LU MK MT MD MC ME NL NO PL PT RO SK SI ES SE CH GB VA'
  ).split(' '),
  global: (
    'AL DZ AR AM AU AT BD BY BE BO BA BR BG KH CA CL CN CO HR CY CZ DK EC EG ' +
    'EE FO FI FR GF GE DE GI GR GP GG HK HU IS IN ID IQ IE IM IL IT JP JE JO ' +
    'KZ XK KW KG LV LI LT LU MO MK MY MT MQ YT MX MD ME MA NL NZ NO OM PK PE ' +
    'PH PL PT PR QA RE RO RU BL MF SM SA RS SG SK SI ZA KR ES LK SE CH TW TH ' +
    'TN TR UA GB UY UZ VA VE VN'
  ).split(' '),
};

export default function TravelDataDestinations({ scope }) {
  const { t, i18n } = useTranslation();
  const codes = destinations[scope];
  if (!codes) return null;

  const locale = i18n?.resolvedLanguage || 'en';
  const regions = new Intl.DisplayNames(locale, { type: 'region' });
  const names = codes.map((code) => regions.of(code)).sort(new Intl.Collator(locale).compare);

  return (
    <details key={scope}>
      <summary style={{ cursor: 'pointer', textDecoration: 'underline' }}>
        {t('upgrade.wireless.coveredDestinations', 'View covered destinations')} ({names.length})
      </summary>
      <ul style={{ columns: '10rem', paddingInlineStart: '1.25rem' }}>
        {names.map((name) => <li key={name}>{name}</li>)}
      </ul>
    </details>
  );
}
