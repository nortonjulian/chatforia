export const THEME_CATALOG = {
  free: ['dawn', 'midnight'],
  premium: ['amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet'],
};

export const ALL_THEMES = [...THEME_CATALOG.free, ...THEME_CATALOG.premium];

export const THEME_LABELS = {
  dawn: 'Dawn (Default)',
  midnight: 'Midnight',
  amoled: 'Amoled',
  aurora: 'Aurora',
  neon: 'Neon',
  sunset: 'Sunset',
  solarized: 'Solarized',
  velvet: 'Velvet',
};

/** Optional: handy metadata for swatches / accessibility / favicon logic */
export const THEME_META = {
  dawn:      { tone: 'light',  preview: 'linear-gradient(90deg,#FFB300,#FF9800)' },
  sunset:    { tone: 'light',  preview: 'linear-gradient(90deg,#FF9800,#FF6F61)' },
  midnight:  { tone: 'dark',   preview: 'linear-gradient(90deg,#6A3CC1,#00C2A8)' },
  neon:      { tone: 'dark',   preview: 'linear-gradient(90deg,#4667F5 0%,#4667F5 58%,#7772F8 86%,#B2C7FF 100%)' },
  amoled:    { tone: 'dark',   preview: 'linear-gradient(90deg,#7C3AED,#5932C7)' },
  aurora:    { tone: 'dark',   preview: 'linear-gradient(90deg,#00C2A8,#29D39A)' },
  solarized: { tone: 'light',  preview: 'linear-gradient(90deg,#B58900,#CB4B16)' },
  velvet:    { tone: 'dark',   preview: 'linear-gradient(90deg,#FF2D7A,#FFD84D)' },
};

/** Tiny helpers (optional) */
export const isDarkTheme = (name) => THEME_META[name]?.tone === 'dark';
export const isLightTheme = (name) => THEME_META[name]?.tone === 'light';
