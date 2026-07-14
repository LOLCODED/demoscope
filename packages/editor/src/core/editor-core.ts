import {
  compileVideoModel,
  type CropRect,
  type CutSegment,
  type SubtitleSegment,
  type VideoClip,
  type VideoEditModel,
  type ZoomSegment,
} from "@demoscope/timeline";

/**
 * Pure, DOM-free mutations of a {@link VideoEditModel}. Every editor operation
 * funnels through here so the same logic drives the browser extension, the web
 * app, and unit tests. Callers wrap these in a history/commit layer for
 * undo/redo — these functions just mutate the model draft they're given.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

export function clipDuration(clip: VideoClip): number {
  return clip.sourceEndMs - clip.sourceStartMs + clip.holdMs;
}

export function zoomDuration(zoom: ZoomSegment): number {
  return zoom.transitionMs * 2 + zoom.holdMs;
}

export function setZoomDuration(zoom: ZoomSegment, valueMs: number): void {
  zoom.holdMs = Math.max(0, valueMs - zoom.transitionMs * 2);
}

/** Recompute total duration as the furthest clip end on the output timeline. */
export function syncTimelineDuration(model: VideoEditModel): void {
  model.durationMs = Math.max(
    1,
    ...model.clips.map((clip) => clip.timelineStartMs + clipDuration(clip))
  );
}

export function addZoom(model: VideoEditModel, atMs: number): string {
  const id = `zoom-${crypto.randomUUID()}`;
  model.zooms.push({
    id,
    startMs: Math.max(0, atMs - 500),
    transitionMs: 500,
    holdMs: 1200,
    centerX: model.viewport.width / 2,
    centerY: model.viewport.height / 2,
    level: 2,
    padding: 0,
  });
  return id;
}

export function addSubtitle(model: VideoEditModel, atMs: number): string {
  const id = `subtitle-${crypto.randomUUID()}`;
  model.subtitles.push({
    id,
    startMs: atMs,
    endMs: Math.min(model.durationMs, atMs + 2000),
    text: "New subtitle",
  });
  return id;
}

export function deleteSegment(model: VideoEditModel, id: string): void {
  for (const group of [
    model.zooms,
    model.subtitles,
    model.cuts,
    model.clips,
  ] as { id: string }[][]) {
    const index = group.findIndex((item) => item.id === id);
    if (index >= 0) group.splice(index, 1);
  }
  syncTimelineDuration(model);
}

/** Split the clip under the playhead into two; returns the new right clip id. */
export function splitAtPlayhead(
  model: VideoEditModel,
  atMs: number
): string | null {
  const clip = model.clips.find((item) => {
    const sourceEnd =
      item.timelineStartMs + item.sourceEndMs - item.sourceStartMs;
    return atMs > item.timelineStartMs && atMs < sourceEnd;
  });
  if (!clip) return null;
  const splitSource = clip.sourceStartMs + atMs - clip.timelineStartMs;
  const right: VideoClip = {
    id: `clip-${crypto.randomUUID()}`,
    timelineStartMs: atMs,
    sourceStartMs: splitSource,
    sourceEndMs: clip.sourceEndMs,
    holdMs: clip.holdMs,
  };
  clip.sourceEndMs = splitSource;
  clip.holdMs = 0;
  model.clips.push(right);
  syncTimelineDuration(model);
  return right.id;
}

/** Add a non-destructive cut over the marked range; returns the new cut id. */
export function removeMarkedRange(
  model: VideoEditModel,
  inMs: number,
  outMs: number
): string | null {
  const startMs = Math.min(inMs, outMs);
  const endMs = Math.max(inMs, outMs);
  if (endMs <= startMs) return null;
  const id = `cut-${crypto.randomUUID()}`;
  model.cuts.push({ id, startMs, endMs });
  return id;
}

/** During playback, jump the playhead over any cut it lands inside. */
export function nextPlayableTime(model: VideoEditModel, time: number): number {
  const cut = model.cuts.find(
    (item) => time >= item.startMs && time < item.endMs
  );
  return cut ? cut.endMs : time;
}

function find(model: VideoEditModel, id: string) {
  return {
    clip: model.clips.find((item) => item.id === id),
    zoom: model.zooms.find((item) => item.id === id),
    subtitle: model.subtitles.find((item) => item.id === id),
    cut: model.cuts.find((item) => item.id === id),
  };
}

/** Output-timeline start position of any segment (for track layout + drag). */
export function segmentStart(model: VideoEditModel, id: string): number {
  const { clip, zoom, subtitle, cut } = find(model, id);
  const compiled = compileVideoModel(model);
  if (clip) return clip.timelineStartMs;
  if (zoom) return compiled.timelineTimeForSource(zoom.startMs);
  if (subtitle) return compiled.timelineTimeForSource(subtitle.startMs);
  return cut ? compiled.timelineTimeForSource(cut.startMs) : 0;
}

export function segmentLength(model: VideoEditModel, id: string): number {
  const { clip, zoom, subtitle, cut } = find(model, id);
  if (clip) return clipDuration(clip);
  if (zoom) return zoomDuration(zoom);
  if (subtitle) return subtitle.endMs - subtitle.startMs;
  return cut ? cut.endMs - cut.startMs : 0;
}

export function setSegmentLength(
  model: VideoEditModel,
  id: string,
  length: number
): void {
  const { clip, zoom, subtitle, cut } = find(model, id);
  const max = model.durationMs - segmentStart(model, id);
  if (clip) {
    clip.holdMs = Math.max(0, length - (clip.sourceEndMs - clip.sourceStartMs));
    syncTimelineDuration(model);
  }
  if (zoom) setZoomDuration(zoom, clamp(length, zoom.transitionMs * 2, max));
  if (subtitle) subtitle.endMs = subtitle.startMs + clamp(length, 100, max);
  if (cut) cut.endMs = cut.startMs + clamp(length, 100, max);
}

/**
 * Retime a segment to a new output-timeline start. Clips reorder freely (the
 * compiler sorts them); zooms/subtitles/cuts are mapped back to source time.
 */
export function moveSegment(
  model: VideoEditModel,
  id: string,
  startMs: number
): void {
  const { clip, zoom, subtitle, cut } = find(model, id);
  const segment = clip ?? zoom ?? subtitle ?? cut;
  if (!segment) return;
  const length = clip
    ? clipDuration(clip)
    : subtitle
      ? subtitle.endMs - subtitle.startMs
      : cut
        ? cut.endMs - cut.startMs
        : 0;
  const next = clip
    ? Math.max(0, startMs)
    : clamp(startMs, 0, model.durationMs - length);
  const sourceNext = compileVideoModel(model).sourceTimeAt(next) ?? next;
  if (clip) {
    clip.timelineStartMs = next;
    syncTimelineDuration(model);
  }
  if (zoom) zoom.startMs = sourceNext;
  if (subtitle) {
    subtitle.startMs = sourceNext;
    subtitle.endMs = sourceNext + length;
  }
  if (cut) {
    cut.startMs = sourceNext;
    cut.endMs = sourceNext + length;
  }
}

export function setZoomFocus(
  model: VideoEditModel,
  id: string,
  centerX: number,
  centerY: number
): void {
  const zoom = model.zooms.find((item) => item.id === id);
  if (!zoom) return;
  zoom.centerX = clamp(centerX, 0, model.viewport.width);
  zoom.centerY = clamp(centerY, 0, model.viewport.height);
}

export function setCrop(model: VideoEditModel, crop: CropRect): void {
  model.crop = crop;
}

export function resetCrop(model: VideoEditModel): void {
  delete model.crop;
}

export type SegmentKind = "clip" | "zoom" | "subtitle" | "cut";

/** Which track a segment id belongs to — for inspector + selection rendering. */
export function segmentKind(
  model: VideoEditModel,
  id: string
): SegmentKind | null {
  const { clip, zoom, subtitle, cut } = find(model, id);
  if (clip) return "clip";
  if (zoom) return "zoom";
  if (subtitle) return "subtitle";
  if (cut) return "cut";
  return null;
}

export type { CropRect, CutSegment, SubtitleSegment, VideoClip, ZoomSegment };
