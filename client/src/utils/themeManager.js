// themeManager.js
// Single source of truth for Chatforia's palette theme (e.g., 'dawn', 'midnight', ...)
// - Persists to localStorage (keys preserved: 'co-theme', 'co-cta')
// - Applies <html data-theme="..."> and a generic data-color-scheme for libraries
// - Cross-tab sync + (optional) follow-system for generic 'light'/'dark'
// - Tiny migration from legacy key if present

import { ALL_THEMES } from '../config/themes';

const LS_KEY_THEME = 'co-theme';
const LS_KEY_CTA   = 'co-cta';
const LEGACY_KEYS  = ['chatforia:themeMode']; // migrate-if-found (from earlier drafts)

/** ------- DEFAULT: Dawn (warm light) ------- */
const DEFAULT_THEME = 'dawn';

/** Add any dark-like palettes here */
const DARK_THEMES = new Set(['dark', 'midnight', 'amoled', 'neon', 'velvet']);

let current = null;
const subs = new Set();

/* ---------------- helpers ---------------- */
function coerce(theme) {
  return ALL_THEMES.includes(theme) ? theme : DEFAULT_THEME;
}

function notify(theme) {
  for (const fn of subs) {
    try { fn(theme); } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent('chatforia:theme', { detail: { theme } }));
  } catch {}
}

/* ---------------- public light/dark helpers ---------------- */
export function isLightTheme(themeName) {
  // Treat these as light-like; everything else is dark-like if listed in DARK_THEMES
  return themeName === 'dawn' || themeName === 'light' || themeName === 'sunset' || themeName === 'solarized';
}

export function isDarkTheme(theme = getTheme()) {
  return DARK_THEMES.has(theme);
}

/* ---------------- core getters/setters ---------------- */
export function getTheme() {
  // 1) current key
  let t = null;
  try { t = localStorage.getItem(LS_KEY_THEME); } catch {}
  if (!t) {
    // 2) try legacy keys and migrate forward
    for (const k of LEGACY_KEYS) {
      try {
        const legacy = localStorage.getItem(k);
        if (legacy) {
          const migrated = coerce(legacy);
          try { localStorage.setItem(LS_KEY_THEME, migrated); } catch {}
          t = migrated;
          break;
        }
      } catch {}
    }
  }
  return coerce(t || DEFAULT_THEME);
}

/** Applies attributes but does NOT write to storage (use setTheme to persist) */
export function applyTheme(theme = getTheme()) {
  current = theme;
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  html.setAttribute('data-color-scheme', isLightTheme(theme) ? 'light' : 'dark');
  notify(theme);
}

/** Persists + applies */
export function setTheme(theme) {
  const next = coerce(theme);
  if (next === current) return;
  try { localStorage.setItem(LS_KEY_THEME, next); } catch {}
  applyTheme(next);
}

/** Subscribe to theme changes in *this* tab. Returns an unsubscribe fn. */
export function onThemeChange(cb) {
  subs.add(cb);
  Promise.resolve().then(() => cb(getTheme()));
  return () => subs.delete(cb);
}

/* ---------------- CTA style helpers (optional accent variant) ---------------- */
export function setCTAStyle(mode /* 'warm' | 'cool' */) {
  const root = document.documentElement;
  if (mode) {
    root.setAttribute('data-cta', mode);
    try { localStorage.setItem(LS_KEY_CTA, mode); } catch {}
  } else {
    root.removeAttribute('data-cta');
    try { localStorage.removeItem(LS_KEY_CTA); } catch {}
  }
}

export function getCTAStyle() {
  try { return localStorage.getItem(LS_KEY_CTA) || ''; } catch { return ''; }
}

/* ---------------- Account-level sync helpers ----------------
   Use these if you load a server preference (e.g., user.theme).
---------------------------------------------------------------- */

/**
 * Apply a theme coming from the server (account-level).
 * Also caches locally so pre-auth screens match next visit.
 */
export function applyAccountTheme(themeFromServer) {
  if (!themeFromServer) return;
  setTheme(themeFromServer);
}

/**
 * Read the locally cached theme to send on signup/login if you want to seed the account.
 */
export function getLocalThemeForServer() {
  return getTheme();
}

/* ---------------- global wiring (call-once IIFE) ----------------
   - Set initial theme as soon as this module loads
   - Restore CTA style
   - Cross-tab sync
   - Follow system only when using generic 'light'/'dark'
----------------------------------------------------------------- */
(function wireGlobal() {
  // 1) apply initial theme before app renders components that rely on it
  applyTheme(getTheme());

  // 2) restore CTA style if previously set
  const savedCTA = getCTAStyle();
  if (savedCTA) document.documentElement.setAttribute('data-cta', savedCTA);

  // 3) cross-tab sync
  window.addEventListener('storage', (e) => {
    if (e.key === LS_KEY_THEME) applyTheme(getTheme());
    if (e.key === LS_KEY_CTA) {
      const v = getCTAStyle();
      if (v) document.documentElement.setAttribute('data-cta', v);
      else document.documentElement.removeAttribute('data-cta');
    }
  });

  // 4) follow system only when using generic light/dark
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (mq?.addEventListener) {
    mq.addEventListener('change', () => {
      const t = getTheme();
      if (t === 'light' || t === 'dark') {
        setTheme(mq.matches ? 'dark' : 'light');
      }
    });
  }
})();
