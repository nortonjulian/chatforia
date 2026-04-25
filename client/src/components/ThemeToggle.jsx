import { useEffect, useState, useCallback } from 'react';
import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { Sun, Moon } from 'lucide-react';
import { getTheme, setTheme, isDarkTheme, onThemeChange } from '@/utils/themeManager';
import axiosClient from '@/api/axiosClient';

export default function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const [theme, setLocalTheme] = useState(() => getTheme());
  const darkLike = isDarkTheme(theme);

  useEffect(() => {
    const unsub = onThemeChange((t) => {
      setLocalTheme(t);
      setColorScheme(isDarkTheme(t) ? 'dark' : 'light');
    });

    setColorScheme(isDarkTheme(theme) ? 'dark' : 'light');
    return unsub;
  }, [setColorScheme]);

  const handleToggle = useCallback(async () => {
    const next = darkLike ? 'dawn' : 'midnight';

    setTheme(next);

    try {
      const { data } = await axiosClient.patch('/users/me', { theme: next });
      console.log('Theme saved:', data?.theme || data);
    } catch (e) {
      console.error('Failed to save theme:', e?.response?.status, e?.response?.data || e);
    }
  }, [darkLike]);

  return (
    <Tooltip label={`Switch to ${darkLike ? 'Dawn' : 'Midnight'} mode`}>
      <ActionIcon
        aria-label="Toggle theme"
        aria-pressed={darkLike}
        role="switch"
        onClick={handleToggle}
        variant="light"
        size="lg"
      >
        {darkLike ? <Sun size={18} /> : <Moon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}