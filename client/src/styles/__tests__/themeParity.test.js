import fs from 'node:fs';
import path from 'node:path';

import { THEME_CATALOG, THEME_LABELS, THEME_META } from '../../config/themes';

const css = fs.readFileSync(path.join(__dirname, '..', 'themes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const brandTokens = Object.fromEntries(
  [...css.matchAll(/--brand-([\w-]+)\s*:\s*(#[0-9a-fA-F]{6});/g)].map(([, name, value]) => [name, value])
);

function resolveBrands(value) {
  return value.replace(/var\(--brand-([\w-]+)\)/g, (_, name) => brandTokens[name] || `missing:${name}`);
}

function themeTokens(code) {
  const tokens = {};
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.includes(`[data-theme="${code}"]`)) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}

function textContrast(foreground, background) {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    return channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

// Approved iOS PR #97 merged commit d04e13f, and Build 50 commit e007ad0 for Neon.
// Velvet keeps its approved gradient and white controls; the owner approved
// deep-plum bubble ink after rendered contrast and visual review.
const verified = {
  dawn: {
    bg: '#FFF7F0', card: '#FFFFFF', border: '#F1E3D8', fg: '#241510', muted: '#745E53',
    accent: 'var(--brand-amber)', incoming: '#FFFFFF', highlighted: '#FFF4D0',
    composer: '#FFFFFF', composerBorder: '#F1E3D8', toolbar: '#241510',
    button: ['#FFB300', '#FF9800'], outgoing: ['#FFB300', '#FF9800'], ink: '#2B1712',
  },
  midnight: {
    bg: '#050B1A', card: '#0E1630', border: '#1B2A49', fg: '#EEF2FF', muted: '#A3AED0',
    accent: 'var(--brand-cyan)', incoming: '#121933', highlighted: '#22344C',
    composer: '#121933', composerBorder: '#1E2747', toolbar: '#3CF9FF',
    button: ['#6A3CC1', '#00C2A8'], outgoing: ['#6A3CC1', '#00C2A8'], ink: '#050B1A',
  },
  neon: {
    bg: '#0D0A22', card: '#211A3D', border: '#4A3C70', fg: '#F4F1FF', muted: '#B9B2D5',
    accent: '#7772F8', incoming: '#29204B', highlighted: '#322957',
    composer: '#241D42', composerBorder: '#756BA5', toolbar: '#7772F8',
    button: ['#4667F5', '#7772F8', '#B2C7FF'],
    outgoing: ['#4667F5', '#7772F8', '#B2C7FF'], ink: '#000000',
  },
  amoled: {
    bg: '#000000', card: '#0A0A0A', border: '#141414', fg: '#F2F2F2', muted: '#A3A3A3',
    accent: '#7C3AED', incoming: '#111111', highlighted: '#171717',
    composer: '#0F0F0F', composerBorder: '#1A1A1A', toolbar: '#7C3AED',
    button: ['#7C3AED', '#5932C7'], outgoing: ['#7C3AED', '#5932C7'], ink: '#FFFFFF',
  },
  aurora: {
    bg: '#03161B', card: '#08252B', border: '#123841', fg: '#E9FFF8', muted: '#A8D8D1',
    accent: '#29D39A', incoming: '#143B4A', highlighted: '#213F52',
    composer: '#0B2323', composerBorder: '#123131', toolbar: '#29D39A',
    button: ['#00C2A8', '#29D39A'], outgoing: ['#29D39A', '#2979FF'], ink: '#03161B',
  },
  sunset: {
    bg: '#F7E8DE', card: '#F1DFD2', border: '#D9C4B5', fg: '#2C1A10', muted: '#7B6152',
    accent: 'var(--brand-orange)', incoming: '#EFE1D7', highlighted: '#DDD7D5',
    composer: '#FFF7F3', composerBorder: '#E2CDBF', toolbar: '#2C1A10',
    button: ['#FF9800', '#FF6F61'], outgoing: ['#FF9A76', '#FF9800'], ink: '#22160E',
  },
  solarized: {
    bg: '#EEE8D5', card: '#E8E3D0', border: '#D6CFB9', fg: '#073642', muted: '#657B83',
    accent: '#B58900', incoming: '#F5F0DF', highlighted: '#DDE1D6',
    composer: '#FDF6E3', composerBorder: '#D6CFB9', toolbar: '#073642',
    button: ['#B58900', '#CB4B16'], outgoing: ['#B58900', '#CB4B16'], ink: '#000000',
  },
  velvet: {
    bg: '#17071C', card: '#241031', border: '#3B1A46', fg: '#FFF3FA', muted: '#DAB5CB',
    accent: '#FF2D7A', incoming: '#2B1736', highlighted: '#29324F',
    composer: '#1F0D26', composerBorder: '#2B1331', toolbar: '#FF2D7A',
    button: ['#FF2D7A', '#FFD84D'], outgoing: ['#FF2D7A', '#FFD84D'], ink: '#FFFFFF',
    bubbleInk: '#241031',
  },
};

test('the eight theme names and entitlements remain intact', () => {
  expect(THEME_CATALOG.free).toEqual(['dawn', 'midnight']);
  expect(THEME_CATALOG.premium).toEqual(['amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet']);
  expect(Object.keys(THEME_LABELS)).toEqual(['dawn', 'midnight', 'amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet']);
});

test.each(Object.entries(verified))('%s matches the verified iOS semantic palette', (code, expected) => {
  const tokens = themeTokens(code);
  expect(tokens['--bg']).toBe(expected.bg);
  expect(tokens['--card']).toBe(expected.card);
  expect(tokens['--border']).toBe(expected.border);
  expect(tokens['--fg']).toBe(expected.fg);
  expect(tokens['--muted']).toBe(expected.muted);
  expect(tokens['--accent']).toBe(expected.accent);
  expect(tokens['--bubble-incoming-bg'].toUpperCase()).toBe(expected.incoming);
  expect(tokens['--surface-highlight-bg']).toBe(expected.highlighted);
  expect(tokens['--composer-field-bg']).toBe(expected.composer);
  expect(tokens['--composer-border']).toBe(expected.composerBorder);
  expect(tokens['--toolbar-icon']).toBe(expected.toolbar);
  expect(tokens['--cta-label']).toBe(expected.ink);
  expect(tokens['--bubble-outgoing-text']).toBe(expected.bubbleInk || expected.ink);
  for (const stop of expected.button) expect(resolveBrands(tokens['--cta-gradient'])).toContain(stop);
  for (const stop of expected.outgoing) expect(resolveBrands(tokens['--bubble-outgoing'])).toContain(stop);
  expect(tokens['--bubble-outgoing']).toContain('135deg');
  expect(tokens['--composer-gradient']).toContain('90deg');
});

test('Neon uses the exact Build 50 gradient stops, directions, ink, and semantic roles', () => {
  const tokens = themeTokens('neon');
  const buttonStops = 'linear-gradient(90deg, #4667F5 0%, #4667F5 58%, #7772F8 86%, #B2C7FF 100%)';
  const bubbleStops = 'linear-gradient(135deg, #4667F5 0%, #4667F5 58%, #7772F8 86%, #B2C7FF 100%)';
  const normalLift = 'linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.03))';
  expect(tokens['--cta-gradient']).toBe(`${normalLift}, ${buttonStops}`);
  expect(tokens['--composer-gradient']).toBe(tokens['--cta-gradient']);
  expect(tokens['--bubble-outgoing']).toBe(`linear-gradient(135deg, rgba(255,255,255,.03), rgba(255,255,255,.03)), ${bubbleStops}`);
  expect(tokens['--neon-pressed-gradient']).toBe(`linear-gradient(90deg, rgba(255,255,255,.06), rgba(255,255,255,.06)), ${buttonStops}`);
  expect(tokens['--neon-disabled-fill']).toBe('#302A4A');
  expect(tokens['--neon-disabled-ink']).toBe('#AFA7CA');
  expect(tokens['--bubble-incoming-fg']).toBe('#F4F1FF');
  expect(tokens['--composer-bg']).toBe('#0D0A22');
  expect(tokens['--composer-ink']).toBe('#000000');
  expect(tokens['--toolbar-text']).toBe('#7772F8');
  expect(tokens['--tab-unselected']).toBe('#AAA3C4');
  expect(tokens['--accent-control-fg']).toBe('#000000');
  expect(THEME_META.neon.preview).toBe('linear-gradient(90deg,#4667F5 0%,#4667F5 58%,#7772F8 86%,#B2C7FF 100%)');
});

test('Neon primary text is a source-approved AA card link color', () => {
  const tokens = themeTokens('neon');
  expect(textContrast(tokens['--fg'], tokens['--card'])).toBeGreaterThanOrEqual(4.5);
  expect(textContrast(tokens['--accent'], tokens['--card'])).toBeLessThan(4.5);
});

test('Neon web controls apply the native pressed and disabled treatments', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', '..', 'styles.css'), 'utf8');
  expect(styles).toMatch(/:root:not\(\[data-theme="dark"\]\) \.composer-theme-field \.mantine-Textarea-input::placeholder\s*\{\s*color: var\(--muted\) !important;/);
  expect(styles).toMatch(/:root\[data-theme="neon"\][^{}]+:active:not\(:disabled\):not\(\[data-disabled\]\)\s*\{\s*background: var\(--neon-pressed-gradient\) !important;/);
  expect(styles).toMatch(/:root\[data-theme="neon"\][^{}]+:is\(:disabled, \[data-disabled\]\)\s*\{[^}]*background: var\(--neon-disabled-fill\) !important;[^}]*color: var\(--neon-disabled-ink\) !important;[^}]*opacity: 1 !important;/);
});

test('active secondary text, composer boundaries, focus, and Neon card links use approved tokens', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', '..', 'styles.css'), 'utf8');
  expect(styles).toContain('--mantine-color-dimmed: var(--muted)');
  expect(styles).toMatch(/:root:is\(\[data-theme="sunset"\], \[data-theme="solarized"\]\)\s*\{\s*--mantine-color-dimmed: var\(--fg\)/);
  expect(styles).toMatch(/:root\[data-theme="solarized"\] \.composer-theme-field \.mantine-Textarea-input::placeholder\s*\{\s*color: var\(--fg\) !important;/);
  expect(styles).toMatch(/\.composer-theme-field \.mantine-Textarea-input\s*\{\s*box-shadow: 0 0 0 1px var\(--muted\)/);
  expect(styles).toMatch(/:root\[data-theme="neon"\] :is\(\.mantine-Card-root, \.mantine-Paper-root\) :is\(a, \.mantine-Anchor-root\):not\(\.auth-link-gradient\)\s*\{\s*color: var\(--fg\) !important;\s*text-decoration: underline;/);
  expect(styles).toMatch(/\.mantine-Textarea-input\):focus-visible\s*\{\s*outline: 2px solid var\(--toolbar-icon, var\(--fg\)\)/);
  expect(styles).toContain('.theme-chip:focus-visible { outline: 2px solid var(--toolbar-icon, var(--fg));');
  expect(styles).toMatch(/:root:is\(\[data-theme="midnight"\], \[data-theme="amoled"\], \[data-theme="aurora"\], \[data-theme="neon"\], \[data-theme="solarized"\]\) :is\(\.outgoing-message-edited, \.outgoing-message-caption\)\s*\{\s*opacity: 1 !important;/);
});

test('Velvet keeps its gradient and white controls while deep-plum bubble text clears AA', () => {
  const tokens = themeTokens('velvet');
  expect(tokens['--composer-ink']).toBe('#FFFFFF');
  expect(tokens['--cta-label']).toBe('#FFFFFF');
  expect(tokens['--bubble-outgoing-text']).toBe('#241031');
  expect(tokens['--bubble-outgoing-shadow']).toBe('none');
  expect(tokens['--bubble-outgoing']).toBe('linear-gradient(135deg, #FF2D7A, #FFD84D)');
  const from = [0xFF, 0x2D, 0x7A];
  const to = [0xFF, 0xD8, 0x4D];
  for (let step = 0; step <= 100; step++) {
    const fraction = step / 100;
    const color = '#' + from.map((value, i) => Math.round(value + (to[i] - value) * fraction)
      .toString(16).padStart(2, '0')).join('');
    expect(textContrast(tokens['--bubble-outgoing-text'], color)).toBeGreaterThanOrEqual(4.5);
  }
  const styles = fs.readFileSync(path.join(__dirname, '..', '..', 'styles.css'), 'utf8');
  expect(styles).toMatch(/:root\[data-theme="velvet"\] \.outgoing-message-caption,[\s\S]*?color: #FFFFFF !important;/);
  expect(styles).toContain(':root[data-theme="velvet"] .sms-message-row[data-outgoing="true"] .sms-bubble[data-has-media="true"]');
  expect(styles).toMatch(/:root\[data-theme="velvet"\] \.outgoing-message-edited\s*\{\s*opacity: 1 !important;/);
});
