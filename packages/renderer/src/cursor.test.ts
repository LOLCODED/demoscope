import { describe, it, expect } from "vitest";
import { interpolateCursor, cursorOverlay } from "./cursor.js";

describe("interpolateCursor", () => {
  it("returns the start point at t=0", () => {
    expect(interpolateCursor(10, 20, 110, 220, 0)).toEqual({ x: 10, y: 20 });
  });

  it("returns the end point at t=1", () => {
    expect(interpolateCursor(10, 20, 110, 220, 1)).toEqual({ x: 110, y: 220 });
  });

  it("reaches the geometric midpoint at t=0.5", () => {
    const mid = interpolateCursor(0, 0, 100, 200, 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(100);
  });
});

describe("cursorOverlay", () => {
  it("anchors the arrow tip hotspot to the cursor position", () => {
    const overlay = cursorOverlay(100, 100, "arrow", 24);
    // Arrow tip is at (2,2) in a 24px viewBox; at size 24 the scale is 1.
    expect(overlay.left).toBe(98);
    expect(overlay.top).toBe(98);
  });

  it("uses the hand tip hotspot for the pointer shape", () => {
    const overlay = cursorOverlay(100, 100, "pointer", 24);
    // Hand tip is at (12,2): x offset by 12, y offset by 2.
    expect(overlay.left).toBe(88);
    expect(overlay.top).toBe(98);
  });

  it("scales the hotspot offset with the cursor size", () => {
    const overlay = cursorOverlay(100, 100, "arrow", 48);
    // scale = 48/24 = 2, so the (2,2) tip moves 4px from the position.
    expect(overlay.left).toBe(96);
    expect(overlay.top).toBe(96);
  });

  it("never positions the overlay off the top-left of the frame", () => {
    const overlay = cursorOverlay(1, 1, "arrow", 24);
    expect(overlay.left).toBe(0);
    expect(overlay.top).toBe(0);
  });
});
