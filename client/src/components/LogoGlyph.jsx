/**
 * Chatforia Glyph (correct final)
 * ✅ Bubble: rounded square + bottom-right tail (attached)
 * ✅ C: thick, centered, opening to the RIGHT, fully inside the bubble
 */
export default function LogoGlyph({ size = 64, className = "" }) {
  const px = typeof size === "number" ? `${size}px` : size;

  // Bubble shape with right-side tail — smooth and centered.
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

  // Correct-facing "C" (opens to the RIGHT)
  const cx = 116; // horizontal center of the C
  const cy = 100; // vertical center
  const r = 46;   // radius
  const sw = 30;  // stroke width

  // Start and end points for the arc (opening on RIGHT)
  const startAngle = 45 * (Math.PI / 180);  // top-right quadrant
  const endAngle = 315 * (Math.PI / 180);   // bottom-right quadrant

  const sx = (cx + r * Math.cos(startAngle)).toFixed(1);
  const sy = (cy - r * Math.sin(startAngle)).toFixed(1);
  const ex = (cx + r * Math.cos(endAngle)).toFixed(1);
  const ey = (cy - r * Math.sin(endAngle)).toFixed(1);

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
      {/* Bubble */}
      <path d={bubblePath} fill="var(--logo-bubble)" />

      {/* Forward-facing C */}
      <path
        d={`M ${sx} ${sy} A ${r} ${r} 0 1 0 ${ex} ${ey}`}
        fill="none"
        stroke="var(--logo-c)"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
