import { type ZoomRect } from "./zoom.js";

/**
 * The per-output-frame state the compositor needs, independent of where the
 * base image comes from (a screenshot index or a video timestamp). Both
 * `RenderFrame` (screenshots) and `VideoRenderFrame` (continuous video) extend
 * this so a single canvas/sharp compositor serves both.
 */
export interface CompositedFrame {
  /** The zoom crop rectangle to apply (viewport CSS pixels). */
  zoomRect: ZoomRect;
  /** Cursor position in viewport coordinates (pre-zoom). */
  cursorX: number;
  cursorY: number;
  /** Whether this frame shows a click (drives the pointer glyph). */
  isClick: boolean;
  /** Text annotation to overlay. */
  annotation?: string;
}
