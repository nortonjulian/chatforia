import { useEffect, useState } from 'react';

const DARK_THEMES = new Set(['dark', 'midnight', 'amoled', 'neon']);

export default function BrandLockup({
  className = '',
  logoSize = 64,
  wordmark = 'Chatforia',
  gradientWordmark = true,
}) {
  const [theme, setTheme] = useState(
    document.documentElement.getAttribute('data-theme') || 'light'
  );

  useEffect(() => {
    const html = document.documentElement;
    const update = () => setTheme(html.getAttribute('data-theme') || 'light');
    const obs = new MutationObserver(update);
    obs.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    update();
    return () => obs.disconnect();
  }, []);

  // Swap asset per theme if desired
  const src = '/brand/ppog.png';

  return (
    <div
      className={`brand-lockup ${className}`}
      style={{ '--logo-size': `${logoSize}px` }}
    >
      <img
        src={src}
        alt="Chatforia logo"
        className="brand-lockup__logo"
        style={{ width: 'var(--logo-size)', height: 'var(--logo-size)' }}
      />
      <h1 className={`brand-lockup__name ${gradientWordmark ? 'text-blue-purple bp-wordmark' : ''}`}>
        {wordmark}
      </h1>
    </div>
  );
}
