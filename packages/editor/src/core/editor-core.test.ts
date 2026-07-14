import { describe, expect, it } from "vitest";
import { DEFAULT_TIMINGS, type VideoEditModel } from "@demoscope/timeline";
import {
  addSubtitle,
  addZoom,
  clipDuration,
  deleteSegment,
  moveSegment,
  nextPlayableTime,
  removeMarkedRange,
  segmentKind,
  setSegmentLength,
  splitAtPlayhead,
  syncTimelineDuration,
} from "./editor-core.js";

function model(): VideoEditModel {
  return {
    durationMs: 10000,
    viewport: { width: 1280, height: 720 },
    fps: 30,
    cursorGlideMs: 400,
    zooms: [],
    subtitles: [],
    cursors: [],
    cuts: [],
    clips: [
      {
        id: "clip-0",
        timelineStartMs: 0,
        sourceStartMs: 0,
        sourceEndMs: 10000,
        holdMs: 0,
      },
    ],
  };
}

describe("addZoom", () => {
  it("adds a centered 1.5x zoom starting one transition before the playhead", () => {
    const m = model();
    const id = addZoom(m, 2000);
    expect(m.zooms).toHaveLength(1);
    const zoom = m.zooms[0];
    expect(zoom.id).toBe(id);
    expect(zoom.startMs).toBe(2000 - DEFAULT_TIMINGS.transitionMs);
    expect(zoom.level).toBe(1.5);
    expect(zoom.centerX).toBe(640);
    expect(zoom.centerY).toBe(360);
  });

  it("clamps the start to zero near the beginning", () => {
    const m = model();
    addZoom(m, 100);
    expect(m.zooms[0].startMs).toBe(0);
  });
});

describe("addSubtitle", () => {
  it("spans the default hold but never past the duration", () => {
    const m = model();
    m.durationMs = 3000;
    addSubtitle(m, 2500);
    expect(m.subtitles[0]).toMatchObject({ startMs: 2500, endMs: 3000 });
  });
});

describe("deleteSegment", () => {
  it("removes a segment and resyncs duration", () => {
    const m = model();
    const id = addZoom(m, 2000);
    deleteSegment(m, id);
    expect(m.zooms).toHaveLength(0);
  });
});

describe("splitAtPlayhead", () => {
  it("splits the clip under the playhead into two", () => {
    const m = model();
    const rightId = splitAtPlayhead(m, 4000);
    expect(rightId).not.toBeNull();
    expect(m.clips).toHaveLength(2);
    const left = m.clips.find((c) => c.id === "clip-0")!;
    const right = m.clips.find((c) => c.id === rightId)!;
    expect(left.sourceEndMs).toBe(4000);
    expect(right).toMatchObject({
      timelineStartMs: 4000,
      sourceStartMs: 4000,
      sourceEndMs: 10000,
    });
    expect(m.durationMs).toBe(10000);
  });

  it("returns null when the playhead is outside every clip", () => {
    const m = model();
    expect(splitAtPlayhead(m, 0)).toBeNull();
    expect(m.clips).toHaveLength(1);
  });
});

describe("removeMarkedRange", () => {
  it("adds a cut for the ordered range", () => {
    const m = model();
    const id = removeMarkedRange(m, 5000, 2000);
    expect(m.cuts[0]).toMatchObject({ id, startMs: 2000, endMs: 5000 });
  });

  it("returns null for an empty range", () => {
    const m = model();
    expect(removeMarkedRange(m, 3000, 3000)).toBeNull();
    expect(m.cuts).toHaveLength(0);
  });
});

describe("nextPlayableTime", () => {
  it("jumps to the end of a cut the playhead falls inside", () => {
    const m = model();
    m.cuts.push({ id: "cut-1", startMs: 3000, endMs: 5000 });
    expect(nextPlayableTime(m, 4000)).toBe(5000);
    expect(nextPlayableTime(m, 2000)).toBe(2000);
  });
});

describe("moveSegment", () => {
  it("clamps a clip start to zero", () => {
    const m = model();
    moveSegment(m, "clip-0", -1000);
    expect(m.clips[0].timelineStartMs).toBe(0);
  });

  it("clamps a subtitle within the timeline keeping its length", () => {
    const m = model();
    const length = DEFAULT_TIMINGS.annotationHoldMs;
    const id = addSubtitle(m, 2000);
    moveSegment(m, id, 9000);
    const sub = m.subtitles[0];
    expect(sub.startMs).toBe(10000 - length); // clamped to duration - length
    expect(sub.endMs - sub.startMs).toBe(length);
  });
});

describe("setSegmentLength", () => {
  it("resizes a subtitle relative to its start", () => {
    const m = model();
    const id = addSubtitle(m, 2000);
    setSegmentLength(m, id, 3000);
    expect(m.subtitles[0].endMs).toBe(5000);
  });
});

describe("syncTimelineDuration + segmentKind", () => {
  it("extends duration by clip hold and reports kinds", () => {
    const m = model();
    m.clips[0].holdMs = 2000;
    syncTimelineDuration(m);
    expect(m.durationMs).toBe(clipDuration(m.clips[0]));
    expect(segmentKind(m, "clip-0")).toBe("clip");
    expect(segmentKind(m, "nope")).toBeNull();
  });
});
