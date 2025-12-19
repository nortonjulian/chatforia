import { useMemo } from 'react';

/**
 * CountrySelect
 * - Uses Intl.supportedValuesOf('region') when available (200+ ISO-3166-1 alpha-2 codes)
 * - Falls back to a reasonable default list
 * - Shows flag + localized country name
 *
 * Props:
 * - value: string (ISO2 like "US")
 * - onChange: (iso2: string) => void
 * - style: inline style object (optional)
 * - disabled: boolean (optional)
 */
export default function CountrySelect({ value = 'US', onChange, style, disabled }) {
  const options = useMemo(() => {
    // Fallback list (used only if Intl.supportedValuesOf isn't available)
    const FALLBACK = [
      'US','CA','GB','IE','FR','DE','ES','IT','NL','BE','CH','AT','SE','NO','DK','FI',
      'AU','NZ','JP','KR','SG','HK','IN','PK','BD','ID','PH','TH','VN','MY',
      'BR','MX','AR','CL','CO','PE',
      'ZA','NG','KE','EG','MA',
      'AE','SA','IL','TR',
    ];

    let regions = FALLBACK;
    try {
      if (typeof Intl?.supportedValuesOf === 'function') {
        // This returns ISO region codes like ["US","CA","GB", ...]
        regions = Intl.supportedValuesOf('region') || FALLBACK;
      }
    } catch {
      regions = FALLBACK;
    }

    // Localized display names (best-effort)
    let dn = null;
    try {
      dn = new Intl.DisplayNames(
        [typeof navigator !== 'undefined' ? navigator.language : 'en'],
        { type: 'region' }
      );
    } catch {
      dn = null;
    }

    const flagEmoji = (iso2) =>
      String(iso2 || '')
        .toUpperCase()
        .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

    // Keep it stable, remove weird entries, sort by label
    const mapped = regions
      .map((cc) => String(cc || '').trim().toUpperCase())
      .filter((cc) => cc.length === 2 && /^[A-Z]{2}$/.test(cc))
      .map((cc) => {
        const name = dn?.of(cc) || cc;
        return { code: cc, label: `${flagEmoji(cc)} ${name}` };
      });

    // De-dupe + sort
    const uniq = Array.from(new Map(mapped.map((x) => [x.code, x])).values());
    uniq.sort((a, b) => a.label.localeCompare(b.label));

    return uniq;
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      style={style}
      disabled={disabled}
      aria-label="Country"
    >
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
