import { useEffect, useState, useCallback } from 'react';
import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { Sun, Moon } from 'lucide-react';
import { getTheme, setTheme, isDarkTheme, onThemeChange } from '@/utils/themeManager';

export default function ThemeToggle({ onToggle }) {
  const { setColorScheme } = useMantineColorScheme();

  // Keep local state in sync with the global theme
  const [theme, setLocalTheme] = useState(() => getTheme());
  const darkLike = isDarkTheme(theme);

  useEffect(() => {
    const unsub = onThemeChange((t) => {
      setLocalTheme(t);
      setColorScheme(isDarkTheme(t) ? 'dark' : 'light');
    });
    // Ensure Mantine tracks the initial scheme
    setColorScheme(isDarkTheme(theme) ? 'dark' : 'light');
    return unsub;
  }, [setColorScheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = useCallback(() => {
    if (typeof onToggle === 'function') {
      onToggle();
      return;
    }
    // Default flip: Dawn <-> Midnight
    const next = darkLike ? 'dawn' : 'midnight';
    setTheme(next); // persists + applies; onThemeChange will sync local state
  }, [darkLike, onToggle]);

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
