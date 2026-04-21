import { type CapturedFrame, type CaptureManifest } from "@demoscope/schema";
import {
  type ZoomRect,
  computeZoomRect,
  fullViewportRect,
  interpolateZoom,
} from "./zoom.js";
import { interpolateCursor } from "./cursor.js";

export interface RenderFrame {
  /** Index of the source CapturedFrame to use as the base image */
  sourceIndex: number;
  /** The zoom crop rectangle to apply */
  zoomRect: ZoomRect;
  /** Cursor position after zoom transform */
  cursorX: number;
  cursorY: number;
  /** Whether this frame represents a click */
  isClick: boolean;
  /** Text annotation to overlay */
  annotation?: string;
}

/**
 * Expand captured frames into a full render timeline with transitions.
 * Inserts interpolated frames between steps that change zoom level.
 */
export function buildRenderTimeline(
  manifest: CaptureManifest,
  transitionMs: number
): RenderFrame[] {
  const { frames, meta } = manifest;
  const { width: vw, height: vh } = meta.viewport;
  const fps = manifest.fps;
  const transitionFrames = Math.round((transitionMs / 1000) * fps);

  const timeline: RenderFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const prevFrame = i > 0 ? frames[i - 1] : null;

    const currentZoom = getZoomRect(frame, vw, vh);
    const prevZoom = prevFrame ? getZoomRect(prevFrame, vw, vh) : null;

    // Insert transition frames if zoom changed between consecutive frames
    if (prevZoom && !rectsEqual(currentZoom, prevZoom) && transitionFrames > 0) {
      for (let t = 1; t <= transitionFrames; t++) {
        const progress = t / transitionFrames;
        const rect = interpolateZoom(prevZoom, currentZoom, progress);
        const cursor = interpolateCursor(
          prevFrame!.cursorX,
          prevFrame!.cursorY,
          frame.cursorX,
          frame.cursorY,
          progress
        );
        timeline.push({
          // Use previous frame's image during transition
          sourceIndex: i - 1,
          zoomRect: rect,
          cursorX: cursor.x,
          cursorY: cursor.y,
          isClick: false,
        });
      }
    }

    // Add the actual frame
    timeline.push({
      sourceIndex: i,
      zoomRect: currentZoom,
      cursorX: frame.cursorX,
      cursorY: frame.cursorY,
      isClick: frame.isClick ?? false,
      annotation: frame.annotation,
    });

    // Hold each frame for a base duration (e.g., 4 frames = ~133ms at 30fps)
    const holdFrames = frame.annotation ? 8 : 3;
    for (let h = 0; h < holdFrames; h++) {
      timeline.push({
        sourceIndex: i,
        zoomRect: currentZoom,
        cursorX: frame.cursorX,
        cursorY: frame.cursorY,
        isClick: false,
        annotation: frame.annotation,
      });
    }
  }

  return timeline;
}

function getZoomRect(
  frame: CapturedFrame,
  vw: number,
  vh: number
): ZoomRect {
  if (frame.zoom) {
    return computeZoomRect(
      frame.zoom.centerX,
      frame.zoom.centerY,
      frame.zoom.level,
      frame.zoom.padding,
      vw,
      vh
    );
  }
  return fullViewportRect(vw, vh);
}

function rectsEqual(a: ZoomRect, b: ZoomRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
