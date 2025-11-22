import { useState, useMemo, useEffect } from 'react';
import { Select, Stack } from '@mantine/core';
import { getTheme, setTheme, onThemeChange } from '../../utils/themeManager';
import { THEME_CATALOG, THEME_LABELS } from '../../config/themes';

export default function ThemeSelect({ isPremium, hideFreeOptions = false }) {
  const [value, setValue] = useState(getTheme());

  // 🔄 Keep the select in sync with the global theme (Sun/Moon, other tabs, etc.)
  useEffect(() => {
    const unsubscribe = onThemeChange((theme) => {
      setValue(theme);
    });
    return unsubscribe;
  }, []);

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
          setTheme(v); // updates <html data-theme>, localStorage, and notifies subscribers
        }}
        id="theme"
        withinPortal
      />
    </Stack>
  );
}
