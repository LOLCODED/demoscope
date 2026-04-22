import sharp from "sharp";

const CURSOR_SIZE = 24;

function cursorSvg(isClick: boolean): Buffer {
  const color = isClick ? "#2563eb" : "#000000";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" viewBox="0 0 24 24">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="1" dy="1" stdDeviation="1" flood-opacity="0.3"/>
      </filter>
    </defs>
    <polygon points="2,2 2,18 7,14 12,20 14,19 9,13 16,12" fill="${color}" stroke="white" stroke-width="1" filter="url(#shadow)"/>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Animated click ring that expands and fades.
 * progress: 0 = just clicked (small, opaque), 1 = fully expanded (large, transparent)
 */
function clickRingSvg(progress: number): Buffer {
  const minRadius = 6;
  const maxRadius = 30;
  const radius = minRadius + (maxRadius - minRadius) * progress;
  const opacity = 0.6 * (1 - progress);
  const strokeWidth = 2.5 * (1 - progress * 0.5);

  const size = Math.ceil(radius * 2 + strokeWidth + 4);
  const center = size / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${center}" cy="${center}" r="${radius}" fill="rgba(37,99,235,${opacity * 0.15})" stroke="rgba(37,99,235,${opacity})" stroke-width="${strokeWidth}"/>
  </svg>`;
  return Buffer.from(svg);
}

export async function composeCursor(
  frame: sharp.Sharp,
  cursorX: number,
  cursorY: number,
  isClick: boolean,
  clickProgress?: number
): Promise<sharp.Sharp> {
  const composites: sharp.OverlayOptions[] = [];

  // Add animated click ring
  if (isClick && clickProgress !== undefined) {
    const progress = Math.max(0, Math.min(1, clickProgress));
    const ringBuffer = clickRingSvg(progress);
    // Parse the SVG size back out (it's variable based on progress)
    const minRadius = 6;
    const maxRadius = 30;
    const radius = minRadius + (maxRadius - minRadius) * progress;
    const strokeWidth = 2.5 * (1 - progress * 0.5);
    const size = Math.ceil(radius * 2 + strokeWidth + 4);

    composites.push({
      input: ringBuffer,
      left: Math.max(0, Math.round(cursorX - size / 2)),
      top: Math.max(0, Math.round(cursorY - size / 2)),
    });
  }

  // Add cursor
  const cursorBuffer = cursorSvg(isClick && (clickProgress ?? 0) < 0.5);
  composites.push({
    input: cursorBuffer,
    left: Math.max(0, Math.round(cursorX)),
    top: Math.max(0, Math.round(cursorY)),
  });

  return frame.composite(composites);
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
