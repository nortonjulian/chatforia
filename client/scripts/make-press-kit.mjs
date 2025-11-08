// client/scripts/make-press-kit.mjs
// Creates /client/public/brand/chatforia-logo-kit.zip AND emits PNGs alongside the SVG masters.
//
// Requires: npm i -D archiver sharp
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import sharp from 'sharp';

const root = path.resolve(process.cwd(), 'client');
const outDir = path.join(root, 'public', 'brand');
const zipPath = path.join(outDir, 'chatforia-logo-kit.zip');

fs.mkdirSync(outDir, { recursive: true });

// ---------- Color + sizing ----------
const GOLD1 = '#FFC83A';
const GOLD2 = '#FFB300';
const GOLD3 = '#FF8A00';
const INK   = '#1f1200';

// ---------- Shared defs: gradient + filters to create volumetric bubble + glow ----------
const SHARED_DEFS = /* xml */`
  <defs>
    <!-- Brand gradient -->
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="${GOLD1}"/>
      <stop offset="55%" stop-color="${GOLD2}"/>
      <stop offset="100%" stop-color="${GOLD3}"/>
    </linearGradient>

    <!-- Soft inner highlight for subtle "C" emboss -->
    <filter id="embossC" x="-20%" y="-20%" width="140%" height="140%">
      <!-- blur the white stroke and knock it into the fill to read like an emboss -->
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur"/>
      <feComponentTransfer in="blur" result="soft">
        <feFuncA type="linear" slope="0.7"/>
      </feComponentTransfer>
    </filter>

    <!-- Outer glow halo -->
    <filter id="outerGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="18" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="1 0 0 0  1
                0 1 0 0  0.75
                0 0 1 0  0
                0 0 0 1  0" result="goldish"/>
      <feMerge>
        <feMergeNode in="goldish"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Right-side cut to make the 'C' opening -->
    <mask id="cut-right">
      <rect x="0" y="0" width="100%" height="100%" fill="white"/>
      <rect x="58%" y="0" width="50%" height="100%" fill="black"/>
    </mask>
  </defs>
`;

// ---------- Core glyph (volumetric rounded bubble + tail RIGHT) ----------
function glyphGroup({ withGlow = false } = {}) {
  return /* xml */`
    <g ${withGlow ? 'filter="url(#outerGlow)"' : ''}>
      <!-- Bubble base with a very light top-to-bottom specular pass -->
      <linearGradient id="bubbleShine" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
        <stop offset="60%" stop-color="rgba(255,255,255,0.03)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.0)"/>
      </linearGradient>

      <!-- Body -->
      <rect x="24" y="32" width="168" height="120" rx="36" ry="36" fill="url(#gold)"/>
      <!-- Subtle soft highlight -->
      <rect x="24" y="32" width="168" height="120" rx="36" ry="36" fill="url(#bubbleShine)"/>

      <!-- RIGHT tail, softened by slightly rounded joins -->
      <path d="M192 102 L232 122 L192 142 Q194 132 194 122 Q194 112 192 102 Z" fill="url(#gold)"/>

      <!-- Embossed C: faint, warm stroke, masked on the right to open -->
      <g mask="url(#cut-right)">
        <circle cx="108" cy="92" r="48"
                fill="none"
                stroke="rgba(255,230,120,0.65)"
                stroke-width="17"
                stroke-linecap="round"
                filter="url(#embossC)"/>
      </g>
    </g>
  `;
}

// ---------- SVG masters ----------
const GLYPH_SVG = /* xml */`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  ${SHARED_DEFS}
  ${glyphGroup({ withGlow: false })}
</svg>`;

const GLYPH_GLOW_SVG = /* xml */`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  ${SHARED_DEFS}
  <!-- Black, vignetted background like your reference -->
  <radialGradient id="bg" cx="50%" cy="40%" r="65%">
    <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="1"/>
  </radialGradient>
  <rect width="256" height="256" fill="url(#bg)"/>
  ${glyphGroup({ withGlow: true })}
</svg>`;

const LOCKUP_SVG = /* xml */`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 300">
  ${SHARED_DEFS}
  <g transform="translate(20,20)">
    ${glyphGroup({ withGlow: false })}
  </g>
  <text x="260" y="175"
        font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
        font-size="120" fill="${INK}">Chatforia</text>
</svg>`;

const LOCKUP_GLOW_SVG = /* xml */`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 360">
  ${SHARED_DEFS}
  <radialGradient id="bg" cx="10%" cy="35%" r="80%">
    <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="1"/>
  </radialGradient>
  <rect width="1100" height="360" fill="url(#bg)"/>
  <g transform="translate(30,30)">
    ${glyphGroup({ withGlow: true })}
  </g>
  <text x="300" y="195"
        font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
        font-size="140" fill="${INK}">Chatforia</text>
</svg>`;

// iOS icon: Apple requires a solid background; we keep the volumetric glyph centered
const IOS_ICON_SVG = /* xml */`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">
  ${SHARED_DEFS}
  <rect width="256" height="256" fill="#000"/> <!-- use black to match press art -->
  ${glyphGroup({ withGlow: true })}
</svg>`;

const ANDROID_ICON_SVG = /* xml */`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256">
  ${SHARED_DEFS}
  <rect width="256" height="256" fill="#000"/>
  ${glyphGroup({ withGlow: true })}
</svg>`;

// ---------- README + colors ----------
const README = `# Chatforia Media Kit

Includes:
- **Glyph** (speech bubble + "C", tail on the right) — SVG & PNG (flat + glow)
- **Wordmark lockup** — SVG & PNG (flat + glow)
- **App icons** — iOS (1024), Android (512), rendered with soft glow on black
- **Brand colors** (JSON)

## Colors
- gold-1: ${GOLD1}
- gold-2: ${GOLD2}
- gold-3: ${GOLD3}
Gradient: 180°, 0% gold-1 → 55% gold-2 → 100% gold-3

Usage notes:
- Prefer SVG for web. PNGs are pre-rasterized for press decks and app stores.
- Keep the 'C' opening on the right. Do not rotate/mirror.
- The glow versions are intended for dark contexts.

© ${new Date().getFullYear()} Chatforia LLC.`;

const COLORS_JSON = JSON.stringify({
  "gold-1": GOLD1,
  "gold-2": GOLD2,
  "gold-3": GOLD3,
  "cta-gradient": "linear-gradient(180deg, #FFC83A 0%, #FFB300 55%, #FF8A00 100%)",
  "wordmark-ink": INK
}, null, 2);

// ---------- Write SVG files to disk ----------
const files = {
  'svg/chatforia-glyph.svg': GLYPH_SVG,
  'svg/chatforia-glyph-glow.svg': GLYPH_GLOW_SVG,
  'svg/chatforia-lockup.svg': LOCKUP_SVG,
  'svg/chatforia-lockup-glow.svg': LOCKUP_GLOW_SVG,
  'svg/app-icon-ios-1024.svg': IOS_ICON_SVG,
  'svg/app-icon-android-512.svg': ANDROID_ICON_SVG,
  'docs/README.md': README,
  'docs/brand-colors.json': COLORS_JSON,
};

for (const [rel, content] of Object.entries(files)) {
  const full = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

// ---------- Rasterize PNGs (sharp) ----------
async function svgToPng({ svgString, outPath, width, height, density = 384 }) {
  // density> default improves filter quality (Gaussian blur) on rasterization
  const buf = Buffer.from(svgString);
  await sharp(buf, { density }).png({ compressionLevel: 9 }).resize({ width, height }).toFile(outPath);
}

await Promise.all([
  // Glyphs
  svgToPng({ svgString: GLYPH_SVG,       outPath: path.join(outDir, 'png/chatforia-glyph-1024.png'),       width: 1024, height: 1024 }),
  svgToPng({ svgString: GLYPH_GLOW_SVG,  outPath: path.join(outDir, 'png/chatforia-glyph-glow-1024.png'),  width: 1024, height: 1024 }),

  // Lockups
  svgToPng({ svgString: LOCKUP_SVG,      outPath: path.join(outDir, 'png/chatforia-lockup-2200x720.png'),  width: 2200, height: 720 }),
  svgToPng({ svgString: LOCKUP_GLOW_SVG, outPath: path.join(outDir, 'png/chatforia-lockup-glow-2200x720.png'), width: 2200, height: 720 }),

  // App icons
  svgToPng({ svgString: IOS_ICON_SVG,    outPath: path.join(outDir, 'png/app-icon-ios-1024.png'),          width: 1024, height: 1024 }),
  svgToPng({ svgString: ANDROID_ICON_SVG,outPath: path.join(outDir, 'png/app-icon-android-512.png'),       width: 512,  height: 512  }),
]);

// ---------- Zip everything ----------
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('warning', (err) => console.warn(err));
archive.on('error', (err) => { throw err; });
archive.pipe(output);

for (const rel of Object.keys(files)) {
  archive.file(path.join(outDir, rel), { name: rel });
}

// Include PNGs in the zip
function addIfExists(rel) {
  const p = path.join(outDir, rel);
  if (fs.existsSync(p)) archive.file(p, { name: rel });
}

[
  'png/chatforia-glyph-1024.png',
  'png/chatforia-glyph-glow-1024.png',
  'png/chatforia-lockup-2200x720.png',
  'png/chatforia-lockup-glow-2200x720.png',
  'png/app-icon-ios-1024.png',
  'png/app-icon-android-512.png',
].forEach(addIfExists);

await archive.finalize();

console.log('✅ Media kit written to:', zipPath);
console.log('   Also wrote SVG/PNG assets to:', outDir);
