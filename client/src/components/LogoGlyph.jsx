import { useMemo } from "react";

/**
 * Chatforia Glyph
 * - Bubble with attached tail
 * - Forward-facing "C"
 * - Vertical amber gradient + soft shadow
 * - Solid-color fallback so the bubble never disappears
 */
export default function LogoGlyph({ size = 64, className = "" }) {
  const px = typeof size === "number" ? `${size}px` : size;

  // SAFE alphanumeric ids for SVG defs
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const bubbleId = `cfBubble_${uid}`;
  const shadowId = `cfShadow_${uid}`;

  // Bubble with tail
  const bubblePath = `
    M 52 32
    H 180
    A 28 28 0 0 1 208 60
    V 140
    A 28 28 0 0 1 180 168
    H 150
    L 210 198
    L 180 168
    H 52
    A 28 28 0 0 1 24 140
    V 60
    A 28 28 0 0 1 52 32
    Z
  `;

  // "C" arc (opens to the RIGHT)
  const cx = 116, cy = 100, r = 46, sw = 30;
  const start = 45 * Math.PI / 180, end = 315 * Math.PI / 180;
  const sx = (cx + r * Math.cos(start)).toFixed(1);
  const sy = (cy - r * Math.sin(start)).toFixed(1);
  const ex = (cx + r * Math.cos(end)).toFixed(1);
  const ey = (cy - r * Math.sin(end)).toFixed(1);

  return (
    <svg
      className={className}
      width={px}
      height={px}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Chatforia"
      style={{ display: "block" }}
    >
      <defs>
        {/* Amber gradient (top → bottom) */}
        <linearGradient id={bubbleId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%"  stopColor="var(--logo-stop-1, #FFC83A)" />
          <stop offset="55%" stopColor="var(--logo-stop-2, #FFB300)" />
          <stop offset="100%" stopColor="var(--logo-stop-3, #FF8A00)" />
        </linearGradient>

        {/* Soft drop shadow */}
        <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodOpacity="0.18" />
        </filter>
      </defs>

      <g filter={`url(#${shadowId})`}>
        {/* 1) Solid-color fallback so the bubble always shows */}
        <path d={bubblePath} fill="var(--logo-bubble, #FFA51A)" />
        {/* 2) Gradient overlay (if the id resolves) */}
        <path d={bubblePath} fill={`url(#${bubbleId})`} />

        {/* Forward-facing C */}
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 1 0 ${ex} ${ey}`}
          fill="none"
          stroke="var(--logo-c, #FFFFFF)"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
