import { describe, it, expect } from "vitest";
import type { CaptureManifest, CapturedFrame } from "@demoscope/schema";
import {
  buildVideoTimeline,
  deriveVideoEditModel,
  compileVideoModel,
  sampleTimeline,
  type VideoTimelineOptions,
} from "./video-timeline.js";

const OPTIONS: VideoTimelineOptions = {
  transitionMs: 500,
  holdMs: 500,
  annotationHoldMs: 1500,
  cursorGlideMs: 400,
  showAnnotations: true,
};

function manifest(
  frames: CapturedFrame[],
  durationMs: number
): CaptureManifest {
  return {
    meta: { baseUrl: "http://x", viewport: { width: 640, height: 360 } },
    fps: 30,
    frames,
    video: { mime: "video/webm", durationMs },
  };
}

const NAV: CapturedFrame = {
  path: "",
  index: 0,
  timestamp: 0,
  videoTimeMs: 0,
  cursorX: 320,
  cursorY: 180,
  action: "navigate",
};

const CLICK: CapturedFrame = {
  path: "",
  index: 1,
  timestamp: 2000,
  videoTimeMs: 2000,
  cursorX: 200,
  cursorY: 150,
  action: "click",
  isClick: true,
  annotation: "Click",
  zoom: { level: 2, padding: 0, centerX: 200, centerY: 150 },
};

function frameAt(timeline: ReturnType<typeof buildVideoTimeline>, ms: number) {
  return timeline.find((f) => Math.abs(f.videoTimeMs - ms) < 0.001)!;
}

describe("buildVideoTimeline", () => {
  const timeline = buildVideoTimeline(manifest([NAV, CLICK], 5000), OPTIONS);

  it("emits one frame per output tick across the video duration", () => {
    // 5000ms @ 30fps → 150 intervals + the t=0 frame.
    expect(timeline).toHaveLength(151);
    expect(timeline[0].videoTimeMs).toBe(0);
    expect(timeline.at(-1)?.videoTimeMs).toBe(5000);
  });

  it("advances output time 1:1 with the video (stays smooth)", () => {
    expect(frameAt(timeline, 1000).videoTimeMs).toBeCloseTo(1000, 3);
    expect(frameAt(timeline, 2000).videoTimeMs).toBeCloseTo(2000, 3);
  });

  it("starts at full viewport", () => {
    expect(timeline[0].zoomRect).toEqual({ x: 0, y: 0, w: 640, h: 360 });
  });

  it("is fully zoomed on the interaction at its moment", () => {
    expect(frameAt(timeline, 2000).zoomRect).toEqual({
      x: 40,
      y: 60,
      w: 320,
      h: 180,
    });
  });

  it("eases back to full view after the hold", () => {
    expect(frameAt(timeline, 4000).zoomRect).toEqual({
      x: 0,
      y: 0,
      w: 640,
      h: 360,
    });
  });

  it("rests the cursor on the first target, then lands it on the next", () => {
    expect(frameAt(timeline, 1000)).toMatchObject({
      cursorX: 320,
      cursorY: 180,
    });
    expect(frameAt(timeline, 2000)).toMatchObject({
      cursorX: 200,
      cursorY: 150,
    });
  });

  it("shows the annotation only within its hold window", () => {
    expect(frameAt(timeline, 1000).annotation).toBeUndefined();
    expect(frameAt(timeline, 2500).annotation).toBe("Click");
    expect(frameAt(timeline, 4000).annotation).toBeUndefined();
  });

  it("omits annotations when disabled", () => {
    const plain = buildVideoTimeline(manifest([NAV, CLICK], 5000), {
      ...OPTIONS,
      showAnnotations: false,
    });
    expect(plain.every((f) => f.annotation === undefined)).toBe(true);
  });
});

describe("editable video model", () => {
  it("seeds one zoom, one subtitle, and one cursor keyframe per relevant event", () => {
    const model = deriveVideoEditModel(manifest([NAV, CLICK], 5000), OPTIONS);
    expect(model.zooms).toHaveLength(1);
    expect(model.subtitles).toHaveLength(1);
    expect(model.cursors).toHaveLength(2);
    // The zoom-in begins one transition before the interaction.
    expect(model.zooms[0].startMs).toBe(1500);
    expect(model.subtitles[0]).toMatchObject({ text: "Click", startMs: 2000 });
  });

  it("re-targets the zoom when the model is edited", () => {
    const model = deriveVideoEditModel(manifest([NAV, CLICK], 5000), OPTIONS);
    // Move the zoom target and widen it; the sampled crop should follow.
    model.zooms[0].centerX = 480;
    model.zooms[0].centerY = 270;
    model.zooms[0].level = 4;
    const compiled = compileVideoModel(model);
    // level 4 → 160x90 crop centered at (480,270): x=400, y=225.
    expect(compiled.frameAt(2000).zoomRect).toEqual({
      x: 400,
      y: 225,
      w: 160,
      h: 90,
    });
  });

  it("drops a zoom entirely when removed from the model", () => {
    const model = deriveVideoEditModel(manifest([NAV, CLICK], 5000), OPTIONS);
    model.zooms = [];
    const compiled = compileVideoModel(model);
    expect(compiled.frameAt(2000).zoomRect).toEqual({
      x: 0,
      y: 0,
      w: 640,
      h: 360,
    });
  });

  it("omits cut source ranges when sampling for export", () => {
    const model = deriveVideoEditModel(manifest([NAV, CLICK], 5000), OPTIONS);
    model.cuts.push({ id: "cut", startMs: 1900, endMs: 2100 });
    expect(
      sampleTimeline(model).some((frame) => frame.videoTimeMs === 2000)
    ).toBe(false);
  });

  it("uses the crop as the unzoomed frame", () => {
    const model = deriveVideoEditModel(manifest([NAV, CLICK], 5000), OPTIONS);
    model.zooms = [];
    model.crop = { x: 100, y: 80, width: 400, height: 200 };
    expect(compileVideoModel(model).frameAt(0).zoomRect).toEqual({
      x: 100,
      y: 80,
      w: 400,
      h: 200,
    });
  });

  it("anchors subtitles in source time so a preceding hold shifts them on the timeline", () => {
    const model = deriveVideoEditModel(manifest([NAV, CLICK], 5000), OPTIONS);
    model.zooms = [];
    model.subtitles = [{ id: "s", startMs: 3000, endMs: 3500, text: "Later" }];
    // A 1000ms freeze-hold after source=1000, then the rest of the footage.
    model.clips = [
      {
        id: "a",
        timelineStartMs: 0,
        sourceStartMs: 0,
        sourceEndMs: 1000,
        holdMs: 1000,
      },
      {
        id: "b",
        timelineStartMs: 2000,
        sourceStartMs: 1000,
        sourceEndMs: 5000,
        holdMs: 0,
      },
    ];
    model.durationMs = 6000;
    const compiled = compileVideoModel(model);
    // Source 3000 now lives at timeline 2000 + (3000 - 1000) = 4000.
    expect(compiled.sourceTimeAt(4000)).toBe(3000);
    expect(compiled.frameAt(4000).annotation).toBe("Later");
    // Its old identity slot (timeline 3000 → source 2000) must not show it.
    expect(compiled.frameAt(3000).annotation).toBeUndefined();
  });

  it("samples an extended clip tail as a freeze-frame hold", () => {
    const model = deriveVideoEditModel(manifest([NAV, CLICK], 5000), OPTIONS);
    model.clips[0].sourceEndMs = 1000;
    model.clips[0].holdMs = 1000;
    model.durationMs = 2000;
    const held = sampleTimeline(model).find(
      (frame) => frame.videoTimeMs === 1000
    );
    expect(held).toBeDefined();
    expect(compileVideoModel(model).sourceTimeAt(1900)).toBe(1000);
  });
});

describe("follow-cursor zooms", () => {
  const followModel = () => {
    const model = deriveVideoEditModel(manifest([NAV], 6000), OPTIONS);
    model.cursorGlideMs = 200;
    model.cursors = [
      { tMs: 0, x: 200, y: 150, isClick: false },
      { tMs: 4000, x: 600, y: 300, isClick: false },
    ];
    model.zooms = [
      {
        id: "f",
        startMs: 1000,
        transitionMs: 400,
        holdMs: 3000,
        centerX: 320,
        centerY: 180,
        level: 2,
        padding: 0,
        followCursor: true,
      },
    ];
    return model;
  };

  it("tracks the interpolated cursor while held", () => {
    const compiled = compileVideoModel(followModel());
    // Cursor rests at (200,150): rect is the cursor-centered 2× crop.
    expect(compiled.frameAt(2000).zoomRect).toEqual({
      x: 40,
      y: 60,
      w: 320,
      h: 180,
    });
    // After the glide to (600,300) the rect re-centers, clamped to bounds.
    expect(compiled.frameAt(4400).zoomRect).toEqual({
      x: 320,
      y: 180,
      w: 320,
      h: 180,
    });
  });

  it("shows the full viewport before the zoom and after easing out", () => {
    const compiled = compileVideoModel(followModel());
    const full = { x: 0, y: 0, w: 640, h: 360 };
    expect(compiled.frameAt(500).zoomRect).toEqual(full);
    expect(compiled.frameAt(5500).zoomRect).toEqual(full);
  });

  it("falls back to the fixed center when there is no cursor data", () => {
    const model = followModel();
    model.cursors = [];
    model.zooms[0].centerX = 200;
    model.zooms[0].centerY = 150;
    expect(compileVideoModel(model).frameAt(2000).zoomRect).toEqual({
      x: 40,
      y: 60,
      w: 320,
      h: 180,
    });
  });
});
