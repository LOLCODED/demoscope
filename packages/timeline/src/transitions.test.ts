import { describe, it, expect } from "vitest";
import type { CaptureManifest, CapturedFrame } from "@demoscope/schema";
import { buildRenderTimeline, type TimelineOptions } from "./transitions.js";

const OPTIONS: TimelineOptions = {
  transitionMs: 500,
  holdMs: 500,
  annotationHoldMs: 1500,
  introHoldMs: 1500,
  showAnnotations: true,
};

function frame(overrides: Partial<CapturedFrame>): CapturedFrame {
  return {
    path: "frame.png",
    index: 0,
    timestamp: 0,
    cursorX: 640,
    cursorY: 360,
    ...overrides,
  };
}

function manifest(frames: CapturedFrame[]): CaptureManifest {
  return {
    meta: { baseUrl: "http://x", viewport: { width: 1280, height: 720 } },
    fps: 30,
    frames,
  };
}

describe("buildRenderTimeline", () => {
  it("holds the first frame for the intro duration", () => {
    const timeline = buildRenderTimeline(manifest([frame({})]), OPTIONS);
    // 1 captured frame + 45 intro-hold frames (1500ms @ 30fps).
    expect(timeline).toHaveLength(46);
    expect(timeline.every((f) => f.sourceIndex === 0)).toBe(true);
  });

  it("inserts zoom transition frames from the previous screenshot", () => {
    const timeline = buildRenderTimeline(
      manifest([
        frame({ index: 0 }),
        frame({
          index: 1,
          zoom: { level: 2, padding: 0, centerX: 640, centerY: 360 },
        }),
      ]),
      OPTIONS
    );

    // The second (zoomed) step contributes frames sourced from its own index.
    expect(timeline.some((f) => f.sourceIndex === 1)).toBe(true);

    // Transition frames replay the previous screenshot (index 0), so there are
    // more index-0 frames than the first step's captured + hold frames alone.
    const indexZero = timeline.filter((f) => f.sourceIndex === 0).length;
    expect(indexZero).toBeGreaterThan(46);

    // The final resting frame lands on the clamped, zoomed crop rect.
    expect(timeline.at(-1)?.zoomRect).toEqual({
      x: 320,
      y: 180,
      w: 640,
      h: 360,
    });
  });

  it("animates typed text character-by-character when annotations are on", () => {
    const timeline = buildRenderTimeline(
      manifest([frame({ action: "type", typedText: "hi" })]),
      OPTIONS
    );
    const typed = timeline.filter((f) => f.annotation?.startsWith('Type "'));
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.at(-1)?.annotation).toBe('Type "hi"');
  });

  it("skips the typing animation when annotations are disabled", () => {
    const timeline = buildRenderTimeline(
      manifest([frame({ action: "type", typedText: "hi" })]),
      { ...OPTIONS, showAnnotations: false }
    );
    expect(timeline.some((f) => f.annotation?.startsWith('Type "'))).toBe(
      false
    );
  });
});
