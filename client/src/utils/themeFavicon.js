const DARK_SET = new Set(['dark', 'midnight', 'amoled', 'neon']);

function ensureFaviconLink() {
  let link = document.querySelector('#cf-favicon');
  if (!link) {
    link = document.createElement('link');
    link.id = 'cf-favicon';
    link.rel = 'icon';
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
    const schemeAttr = html.getAttribute('data-color-scheme');
    const isDark = schemeAttr ? schemeAttr === 'dark' : DARK_SET.has(theme);

    const cs = getComputedStyle(html);
    const s1 = (cs.getPropertyValue('--logo-stop-1') || '').trim();
    const s2 = (cs.getPropertyValue('--logo-stop-2') || '').trim();
    const s3 = (cs.getPropertyValue('--logo-stop-3') || '').trim();

    if (!s1 || !s2 || !s3) {
      link.href = isDark ? '/brand/favicon-dark.svg' : '/brand/favicon-light.svg';
      return;
    }

    const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
    const S = 64 * dpr;

    const key = [theme, s1, s2, s3, dpr].join('|');
    if (key === lastKey) return;

    const bubblePath = `M 154 133 L 139 147 L 130 159 L 121 177 L 116 195 L 116 203 L 115 204 L 115 285 L 116 286 L 116 294 L 118 304 L 122 316 L 130 332 L 136 340 L 155 358 L 174 369 L 188 374 L 203 377 L 291 377 L 337 400 L 346 399 L 349 394 L 349 368 L 350 363 L 353 359 L 368 347 L 380 332 L 390 312 L 395 291 L 395 283 L 396 282 L 396 207 L 395 206 L 395 198 L 391 180 L 384 164 L 377 153 L 360 135 L 348 127 L 325 117 L 311 114 L 304 114 L 303 113 L 207 113 L 206 114 L 199 114 L 177 120 Z`;

    const cPath = `M 246 159 L 270 159 L 287 163 L 297 167 L 312 176 L 325 188 L 331 197 L 330 200 L 327 203 L 304 218 L 299 218 L 295 212 L 286 203 L 276 197 L 267 194 L 259 194 L 258 193 L 248 194 L 233 200 L 225 206 L 218 214 L 211 227 L 207 243 L 207 253 L 208 254 L 209 264 L 211 270 L 218 282 L 230 293 L 240 298 L 247 300 L 266 300 L 276 297 L 286 291 L 294 283 L 301 273 L 304 273 L 328 287 L 331 291 L 330 296 L 325 303 L 312 316 L 302 323 L 292 328 L 271 334 L 264 334 L 263 335 L 249 335 L 248 334 L 241 334 L 232 332 L 216 326 L 199 314 L 188 302 L 182 293 L 177 283 L 171 260 L 172 230 L 177 213 L 186 196 L 200 180 L 212 171 L 226 164 Z`;

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="110 110 290 290" width="${S}" height="${S}">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${s1}"/>
            <stop offset="55%" stop-color="${s2}"/>
            <stop offset="100%" stop-color="${s3}"/>
          </linearGradient>
        </defs>

        <path d="${bubblePath}" fill="url(#g)" />
        <path d="${cPath}" fill="white" />
      </svg>
    `;

    link.href = 'data:image/svg+xml;base64,' + btoa(svg);
    lastKey = key;
  };

  render();

  const obs = new MutationObserver(render);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-color-scheme'],
  });

  window.addEventListener('chatforia:theme', render);

  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', render);

  let lastDpr = window.devicePixelRatio || 1;
  setInterval(() => {
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== lastDpr) {
      lastDpr = dpr;
      render();
    }
  }, 600);
}