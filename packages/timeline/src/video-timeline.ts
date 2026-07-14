import { type CaptureManifest, type CapturedFrame } from "@demoscope/schema";
import {
  type ZoomRect,
  computeZoomRect,
  fullViewportRect,
  interpolateZoom,
} from "./zoom.js";
import { interpolateCursor } from "./cursor-math.js";
import { type CompositedFrame } from "./frame.js";

export interface VideoRenderFrame extends CompositedFrame {
  /** Milliseconds into the recorded video this output frame samples. */
  videoTimeMs: number;
}

export interface VideoTimelineOptions {
  /** Zoom in/out duration in ms. */
  transitionMs: number;
  /** How long to stay zoomed after an interaction before easing back out. */
  holdMs: number;
  /** How long an annotation label stays on screen after its interaction. */
  annotationHoldMs: number;
  /** Duration of the synthetic cursor glide onto each next target. */
  cursorGlideMs: number;
  /** Whether to overlay annotation labels. */
  showAnnotations: boolean;
}

// --- Editable model -------------------------------------------------------

/** A zoom-in/hold/zoom-out around a point in time. Fully user-editable. */
export interface ZoomSegment {
  id: string;
  /** When the zoom-in begins. */
  startMs: number;
  /** Zoom-in (and matching zoom-out) duration. */
  transitionMs: number;
  /** How long to stay fully zoomed after the zoom-in completes. */
  holdMs: number;
  centerX: number;
  centerY: number;
  level: number;
  padding: number;
}

/** A subtitle/annotation label shown over a time range. */
export interface SubtitleSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CursorKeyframe {
  tMs: number;
  x: number;
  y: number;
  isClick: boolean;
}

/** A non-destructive removed range on the source-video timeline. */
export interface CutSegment {
  id: string;
  startMs: number;
  endMs: number;
}

/** A persistent crop in viewport coordinates. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A source-video range placed on the output timeline, with an optional freeze hold. */
export interface VideoClip {
  id: string;
  timelineStartMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  holdMs: number;
}

/**
 * The explicit, serializable source of truth for a video's cinematics. Auto
 * derivation seeds it; the editor mutates it; the renderer consumes it. (This
 * is also the natural unit for a future "steps → document" export.)
 */
export interface VideoEditModel {
  durationMs: number;
  viewport: { width: number; height: number };
  fps: number;
  cursorGlideMs: number;
  zooms: ZoomSegment[];
  subtitles: SubtitleSegment[];
  cursors: CursorKeyframe[];
  cuts: CutSegment[];
  clips: VideoClip[];
  crop?: CropRect;
}

/** A compiled model that can be sampled cheaply at any time (for live preview). */
export interface CompiledVideoModel {
  durationMs: number;
  fps: number;
  frameAt(tMs: number): CompositedFrame;
  sourceTimeAt(tMs: number): number | undefined;
  timelineTimeForSource(sourceTimeMs: number): number;
}

// --- Auto derivation (the default the user then tweaks) --------------------

export function deriveVideoEditModel(
  manifest: CaptureManifest,
  options: VideoTimelineOptions
): VideoEditModel {
  const { frames, meta, fps } = manifest;
  const events = orderedEvents(frames);
  const durationMs =
    manifest.video?.durationMs ?? (events.at(-1)?.t ?? 0) + 1500;

  const zooms: ZoomSegment[] = events
    .filter((e) => e.zoom)
    .map((e, i) => ({
      id: `z${i}`,
      startMs: Math.max(0, e.t - options.transitionMs),
      transitionMs: options.transitionMs,
      holdMs: options.holdMs,
      centerX: e.zoom!.centerX,
      centerY: e.zoom!.centerY,
      level: e.zoom!.level,
      padding: e.zoom!.padding,
    }));

  const subtitles: SubtitleSegment[] = options.showAnnotations
    ? events
        .filter((e) => e.annotation)
        .map((e, i) => ({
          id: `s${i}`,
          startMs: e.t,
          endMs: Math.min(durationMs, e.t + options.annotationHoldMs),
          text: e.annotation!,
        }))
    : [];

  const cursors: CursorKeyframe[] = events.map((e) => ({
    tMs: e.t,
    x: e.cursorX,
    y: e.cursorY,
    isClick: e.isClick,
  }));

  return {
    durationMs,
    viewport: { width: meta.viewport.width, height: meta.viewport.height },
    fps,
    cursorGlideMs: options.cursorGlideMs,
    zooms,
    subtitles,
    cursors,
    cuts: [],
    clips: [
      {
        id: "clip-0",
        timelineStartMs: 0,
        sourceStartMs: 0,
        sourceEndMs: durationMs,
        holdMs: 0,
      },
    ],
  };
}

// --- Compilation + sampling ------------------------------------------------

export function compileVideoModel(model: VideoEditModel): CompiledVideoModel {
  const { width: vw, height: vh } = model.viewport;
  const full = cropRect(model.crop, vw, vh);
  const zoomKeyframes = buildZoomKeyframes(model.zooms, vw, vh, full);
  const cursors = [...model.cursors].sort((a, b) => a.tMs - b.tMs);
  const clips = [...model.clips].sort(
    (a, b) => a.timelineStartMs - b.timelineStartMs
  );

  return {
    durationMs: model.durationMs,
    fps: model.fps,
    frameAt(t: number): CompositedFrame {
      const sourceTime = sourceTimeAt(clips, t) ?? t;
      const cursor = sampleCursor(cursors, sourceTime, model.cursorGlideMs);
      return {
        zoomRect: sampleZoom(zoomKeyframes, sourceTime),
        cursorX: cursor.x,
        cursorY: cursor.y,
        isClick: isClickActive(cursors, sourceTime),
        annotation: activeSubtitle(model.subtitles, sourceTime),
      };
    },
    sourceTimeAt: (t: number) => sourceTimeAt(clips, t),
    timelineTimeForSource: (sourceTime: number) =>
      timelineTimeForSource(clips, sourceTime),
  };
}

/** Sample the whole model into a per-output-frame timeline (for encoding). */
export function sampleTimeline(model: VideoEditModel): VideoRenderFrame[] {
  const compiled = compileVideoModel(model);
  const out: VideoRenderFrame[] = [];
  const dt = 1000 / model.fps;
  const frameCount = Math.max(
    1,
    Math.round((model.durationMs / 1000) * model.fps)
  );
  for (let i = 0; i <= frameCount; i++) {
    const t = Math.min(i * dt, model.durationMs);
    const sourceTime = compiled.sourceTimeAt(t);
    if (sourceTime !== undefined && !isCut(model.cuts, sourceTime)) {
      out.push({ videoTimeMs: sourceTime, ...compiled.frameAt(t) });
    }
  }
  return out;
}

/**
 * Build a time-driven cinematics timeline over a continuously recorded video
 * using the automatic defaults. Convenience wrapper over derive + sample.
 */
export function buildVideoTimeline(
  manifest: CaptureManifest,
  options: VideoTimelineOptions
): VideoRenderFrame[] {
  return sampleTimeline(deriveVideoEditModel(manifest, options));
}

// --- Internals -------------------------------------------------------------

interface ZoomKeyframe {
  t: number;
  rect: ZoomRect;
}

interface TimedEvent {
  t: number;
  cursorX: number;
  cursorY: number;
  zoom?: CapturedFrame["zoom"];
  annotation?: string;
  isClick: boolean;
}

function orderedEvents(frames: CapturedFrame[]): TimedEvent[] {
  return frames
    .map((f) => ({
      t: f.videoTimeMs ?? 0,
      cursorX: f.cursorX,
      cursorY: f.cursorY,
      zoom: f.zoom,
      annotation: f.annotation,
      isClick: f.isClick ?? false,
    }))
    .sort((a, b) => a.t - b.t);
}

function buildZoomKeyframes(
  zooms: ZoomSegment[],
  vw: number,
  vh: number,
  full: ZoomRect
): ZoomKeyframe[] {
  const ordered = [...zooms].sort((a, b) => a.startMs - b.startMs);
  const kfs: ZoomKeyframe[] = [{ t: 0, rect: full }];
  const push = (t: number, rect: ZoomRect) => {
    const lastT = kfs[kfs.length - 1].t;
    const clamped = Math.max(t, lastT);
    if (clamped === lastT) kfs[kfs.length - 1] = { t: clamped, rect };
    else kfs.push({ t: clamped, rect });
  };

  for (let i = 0; i < ordered.length; i++) {
    const z = ordered[i];
    const rect = computeZoomRect(
      z.centerX,
      z.centerY,
      z.level,
      z.padding,
      vw,
      vh
    );
    const fullyStart = z.startMs + z.transitionMs;
    const holdEnd = fullyStart + z.holdMs;
    push(z.startMs, sampleZoom(kfs, z.startMs));
    push(fullyStart, rect);
    push(holdEnd, rect);

    // Ease back to full only if the next zoom isn't about to start (else pan).
    const nextStart = ordered[i + 1]?.startMs ?? Infinity;
    if (nextStart > holdEnd && !rectsEqual(rect, full)) {
      push(holdEnd + z.transitionMs, full);
    }
  }

  return kfs;
}

function sampleZoom(kfs: ZoomKeyframe[], t: number): ZoomRect {
  if (t <= kfs[0].t) return kfs[0].rect;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.rect;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      if (b.t === a.t) return b.rect;
      return interpolateZoom(a.rect, b.rect, (t - a.t) / (b.t - a.t));
    }
  }
  return last.rect;
}

function sampleCursor(
  cursors: CursorKeyframe[],
  t: number,
  glideMs: number
): { x: number; y: number } {
  if (cursors.length === 0) return { x: 0, y: 0 };
  if (t <= cursors[0].tMs) return { x: cursors[0].x, y: cursors[0].y };
  const last = cursors[cursors.length - 1];
  if (t >= last.tMs) return { x: last.x, y: last.y };

  for (let i = 0; i < cursors.length - 1; i++) {
    const a = cursors[i];
    const b = cursors[i + 1];
    if (t >= a.tMs && t <= b.tMs) {
      // Rest at the current target, then glide onto the next just before it.
      const glideStart = b.tMs - Math.min(glideMs, b.tMs - a.tMs);
      if (t <= glideStart) return { x: a.x, y: a.y };
      const progress = (t - glideStart) / (b.tMs - glideStart);
      return interpolateCursor(a.x, a.y, b.x, b.y, progress);
    }
  }
  return { x: last.x, y: last.y };
}

function activeSubtitle(
  subtitles: SubtitleSegment[],
  t: number
): string | undefined {
  for (let i = subtitles.length - 1; i >= 0; i--) {
    const s = subtitles[i];
    if (t >= s.startMs && t <= s.endMs) return s.text;
  }
  return undefined;
}

function isClickActive(cursors: CursorKeyframe[], t: number): boolean {
  return cursors.some((c) => c.isClick && t >= c.tMs && t <= c.tMs + 200);
}

function rectsEqual(a: ZoomRect, b: ZoomRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function isCut(cuts: CutSegment[], t: number): boolean {
  return cuts.some((cut) => t >= cut.startMs && t < cut.endMs);
}

function cropRect(
  crop: CropRect | undefined,
  width: number,
  height: number
): ZoomRect {
  if (!crop) return fullViewportRect(width, height);
  const x = Math.min(Math.max(crop.x, 0), width);
  const y = Math.min(Math.max(crop.y, 0), height);
  return {
    x,
    y,
    w: Math.max(1, Math.min(crop.width, width - x)),
    h: Math.max(1, Math.min(crop.height, height - y)),
  };
}

function sourceTimeAt(
  clips: VideoClip[],
  timelineTime: number
): number | undefined {
  let previous: VideoClip | undefined;
  for (const clip of clips) {
    const sourceLength = clip.sourceEndMs - clip.sourceStartMs;
    const sourceEnd = clip.timelineStartMs + sourceLength;
    const clipEnd = sourceEnd + clip.holdMs;
    if (timelineTime < clip.timelineStartMs) {
      return previous ? previous.sourceEndMs : clip.sourceStartMs;
    }
    if (timelineTime >= clip.timelineStartMs && timelineTime <= clipEnd) {
      return timelineTime < sourceEnd
        ? clip.sourceStartMs + timelineTime - clip.timelineStartMs
        : clip.sourceEndMs;
    }
    previous = clip;
  }
  return previous?.sourceEndMs;
}

function timelineTimeForSource(clips: VideoClip[], sourceTime: number): number {
  const clip = clips.find(
    (item) => sourceTime >= item.sourceStartMs && sourceTime <= item.sourceEndMs
  );
  return clip
    ? clip.timelineStartMs + sourceTime - clip.sourceStartMs
    : sourceTime;
}
