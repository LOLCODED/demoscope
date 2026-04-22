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
  /** Cursor position in viewport coordinates (pre-zoom) */
  cursorX: number;
  cursorY: number;
  /** Whether this frame represents a click */
  isClick: boolean;
  /** Click ring animation progress (0-1), undefined if not a click sequence */
  clickProgress?: number;
  /** Text annotation to overlay */
  annotation?: string;
}

/**
 * Expand captured frames into a full render timeline with smooth transitions.
 * Inserts interpolated frames for:
 * - Zoom level changes (smooth zoom in/out)
 * - Cursor movement between steps (smooth glide)
 * - Click animations (expanding ring over multiple frames)
 */
export function buildRenderTimeline(
  manifest: CaptureManifest,
  transitionMs: number
): RenderFrame[] {
  const { frames, meta } = manifest;
  const { width: vw, height: vh } = meta.viewport;
  const fps = manifest.fps;
  const transitionFrameCount = Math.round((transitionMs / 1000) * fps);

  // Cursor motion: 300ms glide
  const cursorMotionFrames = Math.round((300 / 1000) * fps);
  // Click ring: 400ms animation
  const clickAnimFrames = Math.round((400 / 1000) * fps);

  const timeline: RenderFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const prevFrame = i > 0 ? frames[i - 1] : null;

    const currentZoom = getZoomRect(frame, vw, vh);
    const prevZoom = prevFrame ? getZoomRect(prevFrame, vw, vh) : null;

    const zoomChanged = prevZoom && !rectsEqual(currentZoom, prevZoom);
    const cursorMoved = prevFrame && cursorDistance(prevFrame, frame) > 5;

    // Determine how many transition frames we need
    // Zoom transitions take priority and are longer; cursor-only moves are shorter
    if (zoomChanged && transitionFrameCount > 0) {
      // Zoom + cursor interpolation together
      const count = transitionFrameCount;
      for (let t = 1; t <= count; t++) {
        const progress = t / count;
        const rect = interpolateZoom(prevZoom!, currentZoom, progress);
        const cursor = interpolateCursor(
          prevFrame!.cursorX,
          prevFrame!.cursorY,
          frame.cursorX,
          frame.cursorY,
          progress
        );
        timeline.push({
          sourceIndex: i - 1,
          zoomRect: rect,
          cursorX: cursor.x,
          cursorY: cursor.y,
          isClick: false,
        });
      }
    } else if (cursorMoved && cursorMotionFrames > 0) {
      // Cursor-only glide (no zoom change)
      for (let t = 1; t <= cursorMotionFrames; t++) {
        const progress = t / cursorMotionFrames;
        const cursor = interpolateCursor(
          prevFrame!.cursorX,
          prevFrame!.cursorY,
          frame.cursorX,
          frame.cursorY,
          progress
        );
        timeline.push({
          sourceIndex: i,
          zoomRect: currentZoom,
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
      clickProgress: frame.isClick ? 0 : undefined,
      annotation: frame.annotation,
    });

    // Insert click ring animation frames after a click
    if (frame.isClick && clickAnimFrames > 0) {
      for (let t = 1; t <= clickAnimFrames; t++) {
        const progress = t / clickAnimFrames;
        timeline.push({
          sourceIndex: i,
          zoomRect: currentZoom,
          cursorX: frame.cursorX,
          cursorY: frame.cursorY,
          isClick: true,
          clickProgress: progress,
        });
      }
    }

    // Hold each frame for a base duration
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

function cursorDistance(a: CapturedFrame, b: CapturedFrame): number {
  const dx = a.cursorX - b.cursorX;
  const dy = a.cursorY - b.cursorY;
  return Math.sqrt(dx * dx + dy * dy);
}
