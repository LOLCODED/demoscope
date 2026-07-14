import { type CapturedFrame, type CaptureManifest } from "@demoscope/schema";
import {
  type ZoomRect,
  computeZoomRect,
  fullViewportRect,
  interpolateZoom,
} from "./zoom.js";
import { interpolateCursor } from "./cursor-math.js";
import { type CompositedFrame } from "./frame.js";

export interface RenderFrame extends CompositedFrame {
  /** Index of the source CapturedFrame to use as the base image */
  sourceIndex: number;
}

export interface TimelineOptions {
  transitionMs: number;
  /** Hold time per captured step in ms (no annotation) */
  holdMs: number;
  /** Hold time per captured step in ms when an annotation is shown */
  annotationHoldMs: number;
  /** Extra hold for the very first captured step (intro breathing room) in ms */
  introHoldMs: number;
  /** Whether annotations should be rendered (affects hold time selection) */
  showAnnotations: boolean;
}

/**
 * Expand captured frames into a full render timeline with smooth transitions.
 * Inserts interpolated frames for zoom changes and cursor glides, then holds
 * each captured frame long enough for viewers to read what happened.
 */
export function buildRenderTimeline(
  manifest: CaptureManifest,
  options: TimelineOptions
): RenderFrame[] {
  const { frames, meta } = manifest;
  const { width: vw, height: vh } = meta.viewport;
  const fps = manifest.fps;
  const transitionFrameCount = Math.round((options.transitionMs / 1000) * fps);
  const cursorMotionFrames = Math.round((300 / 1000) * fps);
  const baseHoldFrames = Math.max(1, Math.round((options.holdMs / 1000) * fps));
  const annotationHoldFrames = Math.max(
    baseHoldFrames,
    Math.round((options.annotationHoldMs / 1000) * fps)
  );
  const introHoldFrames = Math.max(
    baseHoldFrames,
    Math.round((options.introHoldMs / 1000) * fps)
  );

  const timeline: RenderFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const prevFrame = i > 0 ? frames[i - 1] : null;

    const currentZoom = getZoomRect(frame, vw, vh);
    const prevZoom = prevFrame ? getZoomRect(prevFrame, vw, vh) : null;

    const zoomChanged = prevZoom && !rectsEqual(currentZoom, prevZoom);
    const cursorMoved = prevFrame && cursorDistance(prevFrame, frame) > 5;

    if (zoomChanged && transitionFrameCount > 0) {
      const fullView = fullViewportRect(vw, vh);
      const prevIsZoomed = !rectsEqual(prevZoom!, fullView);
      const currentIsZoomed = !rectsEqual(currentZoom, fullView);

      if (prevIsZoomed && currentIsZoomed) {
        // Between two zoomed actions, pull back to full view before zooming
        // into the next target so viewers get a sense of where they are.
        const phaseFrames = Math.max(1, Math.round(transitionFrameCount / 2));
        const fullHoldFrames = Math.max(1, Math.round((200 / 1000) * fps));
        const totalFrames = phaseFrames * 2 + fullHoldFrames;
        let step = 0;

        const pushTransition = (rect: ZoomRect) => {
          step++;
          const overall = step / totalFrames;
          const cursor = interpolateCursor(
            prevFrame!.cursorX,
            prevFrame!.cursorY,
            frame.cursorX,
            frame.cursorY,
            overall
          );
          timeline.push({
            sourceIndex: i - 1,
            zoomRect: rect,
            cursorX: cursor.x,
            cursorY: cursor.y,
            isClick: false,
          });
        };

        // Zoom out to full view
        for (let t = 1; t <= phaseFrames; t++) {
          pushTransition(interpolateZoom(prevZoom!, fullView, t / phaseFrames));
        }
        // Brief hold at full view
        for (let h = 0; h < fullHoldFrames; h++) {
          pushTransition(fullView);
        }
        // Zoom into the next target
        for (let t = 1; t <= phaseFrames; t++) {
          pushTransition(
            interpolateZoom(fullView, currentZoom, t / phaseFrames)
          );
        }
      } else {
        // Full → zoomed or zoomed → full: a single interpolation is enough.
        for (let t = 1; t <= transitionFrameCount; t++) {
          const progress = t / transitionFrameCount;
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
      }
    } else if (cursorMoved && cursorMotionFrames > 0) {
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

    // For type frames we reveal the typed text character-by-character using
    // the *previous* screenshot (input still empty) as the backdrop, so it
    // doesn't look like the full string pops into the field at once.
    const hasTyping =
      frame.action === "type" &&
      !!frame.typedText &&
      frame.typedText.length > 0 &&
      options.showAnnotations;

    if (hasTyping) {
      const text = frame.typedText!;
      const msPerChar = 70;
      const totalMs = Math.min(2500, text.length * msPerChar);
      const animFrames = Math.max(2, Math.round((totalMs / 1000) * fps));
      const backdropIndex = i > 0 ? i - 1 : i;

      for (let f = 0; f < animFrames; f++) {
        const progress = (f + 1) / animFrames;
        const charsShown = Math.max(
          1,
          Math.min(text.length, Math.ceil(progress * text.length))
        );
        timeline.push({
          sourceIndex: backdropIndex,
          zoomRect: currentZoom,
          cursorX: frame.cursorX,
          cursorY: frame.cursorY,
          isClick: false,
          annotation: `Type "${text.slice(0, charsShown)}"`,
        });
      }
    }

    // The captured frame itself (post-action screenshot)
    timeline.push({
      sourceIndex: i,
      zoomRect: currentZoom,
      cursorX: frame.cursorX,
      cursorY: frame.cursorY,
      isClick: frame.isClick ?? false,
      annotation: frame.annotation,
    });

    // Hold this step long enough to read it. The very first captured frame
    // gets extra breathing room so viewers can orient before the first action.
    const hasAnnotation = !!frame.annotation && options.showAnnotations;
    let holdFrames: number;
    if (i === 0) {
      holdFrames = hasAnnotation
        ? Math.max(introHoldFrames, annotationHoldFrames)
        : introHoldFrames;
    } else {
      holdFrames = hasAnnotation ? annotationHoldFrames : baseHoldFrames;
    }
    for (let h = 0; h < holdFrames; h++) {
      timeline.push({
        sourceIndex: i,
        zoomRect: currentZoom,
        cursorX: frame.cursorX,
        cursorY: frame.cursorY,
        // Keep the click/pointer shape visible for the full hold so the
        // pointer-hand reads as "clicked here" rather than a 1-frame flash.
        isClick: frame.isClick ?? false,
        annotation: frame.annotation,
      });
    }
  }

  return timeline;
}

function getZoomRect(frame: CapturedFrame, vw: number, vh: number): ZoomRect {
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
