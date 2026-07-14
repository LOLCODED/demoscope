import { describe, it, expect } from "vitest";
import { extractRect, cursorInFrame } from "./frame-geometry.js";

describe("extractRect", () => {
  it("scales a full-viewport rect to the whole source image", () => {
    const rect = extractRect({ x: 0, y: 0, w: 640, h: 360 }, 2, 1280, 720);
    expect(rect).toEqual({ left: 0, top: 0, width: 1280, height: 720 });
  });

  it("scales and offsets a zoomed rect by the device scale", () => {
    const rect = extractRect({ x: 320, y: 180, w: 320, h: 180 }, 2, 1280, 720);
    expect(rect).toEqual({ left: 640, top: 360, width: 640, height: 360 });
  });

  it("clamps the crop so it never runs past the source bounds", () => {
    // A rect pushed to the far edge gets pulled back to fit.
    const rect = extractRect({ x: 600, y: 340, w: 320, h: 180 }, 2, 1280, 720);
    expect(rect.left).toBe(640);
    expect(rect.top).toBe(360);
    expect(rect.left + rect.width).toBeLessThanOrEqual(1280);
    expect(rect.top + rect.height).toBeLessThanOrEqual(720);
  });

  it("never returns a zero-sized crop", () => {
    const rect = extractRect({ x: 0, y: 0, w: 0, h: 0 }, 2, 1280, 720);
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
  });
});

describe("cursorInFrame", () => {
  it("maps a cursor at the zoom-rect origin to the frame's top-left", () => {
    const p = cursorInFrame(
      320,
      180,
      { x: 320, y: 180, w: 320, h: 180 },
      1280,
      720
    );
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it("maps the zoom-rect center to the frame center", () => {
    const p = cursorInFrame(
      480,
      270,
      { x: 320, y: 180, w: 320, h: 180 },
      1280,
      720
    );
    expect(p.x).toBeCloseTo(640);
    expect(p.y).toBeCloseTo(360);
  });

  it("scales cursor position by the zoom magnification", () => {
    // Full viewport → identity mapping onto the output size.
    const p = cursorInFrame(320, 180, { x: 0, y: 0, w: 640, h: 360 }, 640, 360);
    expect(p).toEqual({ x: 320, y: 180 });
  });
});
