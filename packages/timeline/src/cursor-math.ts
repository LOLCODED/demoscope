export const DEFAULT_CURSOR_SIZE = 24;
const VIEWBOX_SIZE = 24;

export type CursorShape = "arrow" | "pointer";

// Hotspot (tip) in SVG coords for each cursor shape.
// Arrow: top-left point of the polygon.
// Hand:  top-center of the extended index finger.
const ARROW_TIP = { x: 2, y: 2 };
const HAND_TIP = { x: 12, y: 2 };

const SHADOW_DEFS = `<defs>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="1" dy="1" stdDeviation="1" flood-opacity="0.3"/>
  </filter>
</defs>`;

function arrowSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}">
    ${SHADOW_DEFS}
    <polygon points="2,2 2,18 7,14 12,20 14,19 9,13 16,12" fill="#111111" stroke="white" stroke-width="1" filter="url(#shadow)"/>
  </svg>`;
}

// Simplified pointing hand: extended index finger + hand/palm below.
// Outlined in white so it reads on any background.
function handSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}">
    ${SHADOW_DEFS}
    <path d="M 11 2 L 13 2 L 13 12.5 L 17 12.5 L 18 13.5 L 18 21 L 17 22 L 7 22 L 6 21 L 6 13.5 L 7 12.5 L 11 12.5 Z"
      fill="#2563eb" stroke="white" stroke-width="1" filter="url(#shadow)"/>
  </svg>`;
}

export function cursorSvg(shape: CursorShape, size: number): string {
  return shape === "pointer" ? handSvg(size) : arrowSvg(size);
}

export interface CursorPlacement {
  /** SVG markup for the cursor glyph. */
  svg: string;
  /** Left offset so the shape's hotspot lands on the cursor position. */
  left: number;
  /** Top offset so the shape's hotspot lands on the cursor position. */
  top: number;
}

/**
 * Resolve the cursor glyph and its top-left placement so the shape's hotspot
 * (tip) sits exactly on the cursor coordinate. Shared by the Node/sharp
 * renderer and the in-browser canvas compositor so both agree pixel-for-pixel.
 */
export function cursorPlacement(
  cursorX: number,
  cursorY: number,
  shape: CursorShape,
  size: number = DEFAULT_CURSOR_SIZE
): CursorPlacement {
  const tip = shape === "pointer" ? HAND_TIP : ARROW_TIP;
  const scale = size / VIEWBOX_SIZE;
  return {
    svg: cursorSvg(shape, size),
    left: Math.max(0, Math.round(cursorX - tip.x * scale)),
    top: Math.max(0, Math.round(cursorY - tip.y * scale)),
  };
}

/**
 * Ease-in-out interpolation for smooth cursor glide between positions.
 */
export function interpolateCursor(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  t: number
): { x: number; y: number } {
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return {
    x: fromX + (toX - fromX) * ease,
    y: fromY + (toY - fromY) * ease,
  };
}
