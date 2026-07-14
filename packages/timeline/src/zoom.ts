export interface ZoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function interpolateZoom(
  from: ZoomRect,
  to: ZoomRect,
  t: number
): ZoomRect {
  const ease = cubicInOut(t);
  return {
    x: Math.round(lerp(from.x, to.x, ease)),
    y: Math.round(lerp(from.y, to.y, ease)),
    w: Math.round(lerp(from.w, to.w, ease)),
    h: Math.round(lerp(from.h, to.h, ease)),
  };
}

export function computeZoomRect(
  centerX: number,
  centerY: number,
  level: number,
  padding: number,
  viewportWidth: number,
  viewportHeight: number
): ZoomRect {
  const cropW = Math.round(viewportWidth / level);
  const cropH = Math.round(viewportHeight / level);

  let x = Math.round(centerX - cropW / 2);
  let y = Math.round(centerY - cropH / 2);

  // Clamp to viewport bounds
  x = Math.max(0, Math.min(x, viewportWidth - cropW));
  y = Math.max(0, Math.min(y, viewportHeight - cropH));

  return { x, y, w: cropW, h: cropH };
}

export function fullViewportRect(
  viewportWidth: number,
  viewportHeight: number
): ZoomRect {
  return { x: 0, y: 0, w: viewportWidth, h: viewportHeight };
}
