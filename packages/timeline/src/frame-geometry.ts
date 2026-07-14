import { type ZoomRect } from "./zoom.js";

export interface ExtractRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Map a zoom rect (in viewport CSS pixels) onto the device-scaled source
 * screenshot, clamped to its bounds. Returns integer pixel coordinates ready
 * for a crop (sharp `.extract`) or a `drawImage` source rect. Shared by the
 * Node renderer and the in-browser compositor so both crop identically.
 */
export function extractRect(
  zoom: ZoomRect,
  scale: number,
  sourceWidth: number,
  sourceHeight: number
): ExtractRect {
  const left = Math.max(
    0,
    Math.min(zoom.x * scale, sourceWidth - zoom.w * scale)
  );
  const top = Math.max(
    0,
    Math.min(zoom.y * scale, sourceHeight - zoom.h * scale)
  );
  const width = Math.min(zoom.w * scale, sourceWidth - left);
  const height = Math.min(zoom.h * scale, sourceHeight - top);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * Position of a viewport-space cursor coordinate within the zoomed, resized
 * output frame.
 */
export function cursorInFrame(
  cursorX: number,
  cursorY: number,
  zoom: ZoomRect,
  outputWidth: number,
  outputHeight: number
): { x: number; y: number } {
  return {
    x: ((cursorX - zoom.x) / zoom.w) * outputWidth,
    y: ((cursorY - zoom.y) / zoom.h) * outputHeight,
  };
}
