import { useState, useMemo, useEffect } from 'react';
import { Select, Stack } from '@mantine/core';
import { getTheme, setTheme, onThemeChange } from '../../utils/themeManager';
import { THEME_CATALOG, THEME_LABELS } from '../../config/themes';

export default function ThemeSelect({ isPremium, hideFreeOptions = false }) {
  const [value, setValue] = useState(getTheme());

  // On mount: sync global theme + subscribe to external theme changes
  useEffect(() => {
    // Ensure we align with whatever the manager thinks the theme is
    const initial = getTheme();
    setValue(initial);
    setTheme(initial); // <- this is what your test expects

    // Keep the select in sync with global theme changes (Sun/Moon, other tabs, etc.)
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

          // Block premium themes for non-premium users
          if (!isPremium && THEME_CATALOG.premium.includes(v)) return;

          setValue(v);
          setTheme(v); // updates <html>, localStorage, and notifies subscribers
        }}
        id="theme"
        withinPortal
      />
    </Stack>
  );
}
