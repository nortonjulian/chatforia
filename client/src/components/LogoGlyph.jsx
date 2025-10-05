import { useId } from 'react';

export default function LogoGlyph({ size = 64, className = '' }) {
  const s = size;
  const uid = useId().replace(/:/g, '');
  const gradId = `cfG_${uid}`;

  // Master bubble (rounded square with right tail)
  const bubblePath =
    'M288 176H736C828 176 880 248 880 344V592C880 636 862 678 832 708C820 720 812 737 812 754V884C812 903 793 915 776 907L606 824H352C232 824 144 736 144 616V344C144 240 204 176 288 176Z';

  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 1024 1024"
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
      shapeRendering="geometricPrecision"
    >
      <defs>
        {/* theme-driven gradient; picks up --logo-stop-1..3 from themes.css */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--logo-stop-1, #FFC83A)" />
          <stop offset="55%"  stopColor="var(--logo-stop-2, #FFB300)" />
          <stop offset="100%" stopColor="var(--logo-stop-3, #FF8A00)" />
        </linearGradient>
      </defs>

      {/* Bubble (force paint). Giving it a data-attr avoids old CSS collisions */}
      <path data-bubble d={bubblePath} fill={`url(#${gradId})`} />

      {/* EXACT “C”: stroke-only arc with rounded ends and a right-side gap */}
      <circle
        cx="512" cy="520" r="230"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="168"
        strokeLinecap="round"
        strokeDasharray="1320 360"
        strokeDashoffset="-180"   /* gap faces right */
      />
    </svg>
  );
}
