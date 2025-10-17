import { useState, useMemo, useEffect } from 'react';
import { Select, Stack } from '@mantine/core';
import { getTheme, setTheme } from '../../utils/themeManager';
import { THEME_CATALOG, THEME_LABELS } from '../../config/themes';

export default function ThemeSelect({ isPremium, hideFreeOptions = false }) {
  const [value, setValue] = useState(getTheme());

  useEffect(() => {
    // ensure current theme applied on mount
    setTheme(value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toOpt = (t) => ({ value: t, label: THEME_LABELS[t] || t });

  const data = useMemo(() => {
    const groups = [];
    if (!hideFreeOptions) {
      groups.push({ group: 'Free', items: THEME_CATALOG.free.map(toOpt) });
    }
    groups.push({
      group: 'Premium',
      items: THEME_CATALOG.premium.map((t) => ({
        ...toOpt(t),
        disabled: !isPremium,
      })),
    });
    return groups;
  }, [isPremium, hideFreeOptions]);

  return (
    <Stack gap="sm">
      <Select
        label="Theme"
        value={value}
        data={data}
        onChange={(v) => {
          if (!v) return;
          if (!isPremium && THEME_CATALOG.premium.includes(v)) return;
          setValue(v);
          setTheme(v); // updates <html data-theme> and localStorage
        }}
        id="theme"
        withinPortal
      />
    </Stack>
  );
}
