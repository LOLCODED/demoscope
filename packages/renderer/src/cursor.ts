import sharp from "sharp";

const CURSOR_SIZE = 24;

// Generate a cursor SVG (simple arrow pointer with shadow)
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

// Generate click ring SVG (expanding circle)
function clickRingSvg(radius: number, opacity: number): Buffer {
  const size = radius * 2 + 4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="rgba(37,99,235,${opacity})" stroke-width="2"/>
  </svg>`;
  return Buffer.from(svg);
}

export async function composeCursor(
  frame: sharp.Sharp,
  cursorX: number,
  cursorY: number,
  isClick: boolean
): Promise<sharp.Sharp> {
  const composites: sharp.OverlayOptions[] = [];

  // Add click ring if this is a click frame
  if (isClick) {
    const ringRadius = 20;
    const ringBuffer = clickRingSvg(ringRadius, 0.5);
    composites.push({
      input: ringBuffer,
      left: Math.max(0, Math.round(cursorX - ringRadius - 2)),
      top: Math.max(0, Math.round(cursorY - ringRadius - 2)),
    });
  }

  // Add cursor
  const cursorBuffer = cursorSvg(isClick);
  composites.push({
    input: cursorBuffer,
    left: Math.max(0, Math.round(cursorX)),
    top: Math.max(0, Math.round(cursorY)),
  });

  return frame.composite(composites);
}

export function interpolateCursor(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  t: number
): { x: number; y: number } {
  // Simple ease-in-out for cursor movement
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return {
    x: fromX + (toX - fromX) * ease,
    y: fromY + (toY - fromY) * ease,
  };
}
