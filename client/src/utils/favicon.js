import { isLightTheme } from './themeManager';

export function applyThemeColorMeta(light) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#ffffff' : '#0b0b0b');
  const mask = document.querySelector('link#mask-icon');
  if (mask) mask.setAttribute('color', light ? '#111111' : '#f5f5f5');
}

export function setFaviconForTheme(themeName) {
  const light = isLightTheme(themeName);
  const lightLink = document.querySelector('link#favicon-light');
  const darkLink  = document.querySelector('link#favicon-dark');

  // Only one should “win” (media=all) at a time
  if (lightLink && darkLink) {
    lightLink.media = light ? 'all' : 'not all';
    darkLink.media  = light ? 'not all' : 'all';
  }
  applyThemeColorMeta(light);
}
