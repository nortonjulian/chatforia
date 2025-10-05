// src/lib/themeFavicon.js
// Renders a dynamic, theme-aware favicon with your new chat bubble + white C.
// Transparent page bg; bubble uses theme gradient (--logo-stop-1..3).

const DARK_SET = new Set(['dark', 'midnight', 'amoled', 'neon']);

function ensureFaviconLink() {
  let link = document.querySelector('#cf-favicon');
  if (!link) {
    link = document.createElement('link');
    link.id = 'cf-favicon';
    link.rel = 'icon';
    // 'any' tells browsers it's an SVG that can be rasterized at any size
    link.setAttribute('sizes', 'any');
    link.setAttribute('type', 'image/svg+xml');
    document.head.appendChild(link);
  }
  return link;
}

export function installThemeFaviconObserver() {
  const link = ensureFaviconLink();
  let lastKey = '';

  const render = () => {
    const html = document.documentElement;
    const theme = html.getAttribute('data-theme') || 'dawn';
    const schemeAttr = html.getAttribute('data-color-scheme'); // 'light' | 'dark'
    const isDark = schemeAttr ? schemeAttr === 'dark' : DARK_SET.has(theme);

    // Pull gradient stops from CSS (set per-theme in themes.css)
    const cs = getComputedStyle(html);
    const s1 = (cs.getPropertyValue('--logo-stop-1') || '').trim();
    const s2 = (cs.getPropertyValue('--logo-stop-2') || '').trim();
    const s3 = (cs.getPropertyValue('--logo-stop-3') || '').trim();

    if (!s1 || !s2 || !s3) {
      // Sanity fallback (shouldn't hit if themes.css defines the stops)
      link.href = isDark ? '/brand/favicon-dark.svg' : '/brand/favicon-light.svg';
      return;
    }

    // Hi-DPI raster target: we encode bigger for crisp downscaling.
    // 48 * DPR keeps details (tail + C) visible at 16px UI size.
    const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
    const S = 48 * dpr;                 // SVG canvas size
    const pad = Math.round(S * 0.06);   // outer breathing room

    // Chat bubble geometry
    const tailW = Math.round(S * 0.18); // tail width
    const tailH = Math.round(S * 0.22); // tail height
    const rx    = Math.round(S * 0.18); // corner radius (rounded square look)

    // Bubble rect (leaves room for tail to the right)
    const bx = pad;
    const by = pad;
    const bw = S - pad * 2 - tailW;
    const bh = S - pad * 2;

    // White "C" geometry (balanced so bubble & tail remain recognizable)
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const r  = Math.min(bw, bh) * 0.36;        // C center radius
    const cw = r * 0.58;                       // C stroke thickness
    const gapDeg = 78;                         // opening (right side)
    const C     = 2 * Math.PI * r;
    const dashOn  = C * ((360 - gapDeg) / 360);
    const dashOff = C * (gapDeg / 360);
    const dashOffset = -(dashOff / 2);         // center the gap at 3 o’clock

    // Subtle border/halo for mixed tab backgrounds
    const halo = isDark ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.12)';

    // Tail path (simple rounded triangle that meets the rounded rect)
    // Anchor on bottom-right edge of rect.
    const tailBaseX = bx + bw;
    const tailBaseY = by + bh - Math.min(rx * 0.9, bh * 0.2);
    const tailTipX  = bx + bw + tailW;
    const tailTipY  = by + bh - tailH * 0.45;

    const tailPath = [
      `M ${tailBaseX} ${tailBaseY}`,
      `Q ${tailBaseX + tailW * 0.25} ${by + bh}, ${tailTipX} ${tailTipY}`,
      `Q ${tailBaseX + tailW * 0.25} ${tailTipY - tailH * 0.7}, ${tailBaseX} ${tailBaseY - tailH * 0.35}`,
      'Z'
    ].join(' ');

    // Key to avoid redundant re-encoding
    const key = [
      theme, s1, s2, s3, dpr,
      bx, by, bw, bh, rx,
      r.toFixed(2), cw.toFixed(2), gapDeg
    ].join('|');
    if (key === lastKey) return;

    // Build SVG
    const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s1}"/>
      <stop offset="55%" stop-color="${s2}"/>
      <stop offset="100%" stop-color="${s3}"/>
    </linearGradient>
  </defs>

  <!-- Halo/border for contrast -->
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${rx}" ry="${rx}"
        fill="none" stroke="${halo}" stroke-width="${Math.max(1, Math.round(S*0.03))}"/>

  <!-- Bubble base (rounded square) -->
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${rx}" ry="${rx}" fill="url(#g)"/>

  <!-- Tail, filled with the same gradient -->
  <path d="${tailPath}" fill="url(#g)"/>

  <!-- White C -->
  <circle cx="${cx}" cy="${cy}" r="${r}"
          fill="none" stroke="white" stroke-width="${cw}"
          stroke-linecap="round"
          stroke-dasharray="${dashOn} ${dashOff}"
          stroke-dashoffset="${dashOffset}"/>
</svg>`;

    link.href = 'data:image/svg+xml;base64,' + btoa(svg);
    lastKey = key;
  };

  render();

  // Re-render on theme flips, scheme changes, or DPR changes (zoom/monitor move)
  const obs = new MutationObserver(render);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-color-scheme'] });
  window.addEventListener('chatforia:theme', render);
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', render);
  // crude DPR watcher
  let lastDpr = window.devicePixelRatio || 1;
  setInterval(() => {
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== lastDpr) { lastDpr = dpr; render(); }
  }, 600);
}
