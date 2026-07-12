import { describe, it, expect } from "vitest";
import {
  cubicInOut,
  computeZoomRect,
  interpolateZoom,
  fullViewportRect,
} from "./zoom.js";

describe("cubicInOut", () => {
  it("pins the endpoints", () => {
    expect(cubicInOut(0)).toBe(0);
    expect(cubicInOut(1)).toBe(1);
  });

  it("is symmetric around the midpoint", () => {
    expect(cubicInOut(0.5)).toBeCloseTo(0.5);
    expect(cubicInOut(0.25) + cubicInOut(0.75)).toBeCloseTo(1);
  });
});

describe("computeZoomRect", () => {
  it("scales the crop by the zoom level", () => {
    const rect = computeZoomRect(640, 360, 2, 0, 1280, 720);
    expect(rect.w).toBe(640);
    expect(rect.h).toBe(360);
  });

  it("centers the crop on the target when there is room", () => {
    const rect = computeZoomRect(640, 360, 2, 0, 1280, 720);
    expect(rect.x).toBe(320);
    expect(rect.y).toBe(180);
  });

  it("clamps the crop to the top-left edge", () => {
    const rect = computeZoomRect(0, 0, 2, 0, 1280, 720);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it("clamps the crop to the bottom-right edge", () => {
    const rect = computeZoomRect(1280, 720, 2, 0, 1280, 720);
    expect(rect.x).toBe(1280 - rect.w);
    expect(rect.y).toBe(720 - rect.h);
  });
});

describe("interpolateZoom", () => {
  const from = { x: 0, y: 0, w: 1280, h: 720 };
  const to = { x: 320, y: 180, w: 640, h: 360 };

  it("returns the start rect at t=0", () => {
    expect(interpolateZoom(from, to, 0)).toEqual(from);
  });

  it("returns the end rect at t=1", () => {
    expect(interpolateZoom(from, to, 1)).toEqual(to);
  });

  it("returns integer coordinates mid-transition", () => {
    const mid = interpolateZoom(from, to, 0.5);
    for (const v of Object.values(mid)) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("fullViewportRect", () => {
  it("covers the whole viewport at the origin", () => {
    expect(fullViewportRect(1280, 720)).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 720,
    });
  });
});
