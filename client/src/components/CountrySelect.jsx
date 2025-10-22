import React from 'react';

// Minimal list; extend as needed
const COUNTRIES = [
  { code: 'US', name: 'United States (+1)' },
  { code: 'CA', name: 'Canada (+1)' },
  { code: 'GB', name: 'United Kingdom (+44)' },
  { code: 'IN', name: 'India (+91)' },
  { code: 'AU', name: 'Australia (+61)' },
  { code: 'FR', name: 'France (+33)' },
  { code: 'DE', name: 'Germany (+49)' },
  { code: 'BR', name: 'Brazil (+55)' },
  { code: 'MX', name: 'Mexico (+52)' },
  { code: 'ZA', name: 'South Africa (+27)' },
];

export default function CountrySelect({ value, onChange, style }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      style={style}
      aria-label="Country"
    >
      {COUNTRIES.map(c => (
        <option key={c.code} value={c.code}>{c.name}</option>
      ))}
    </select>
  );
}
