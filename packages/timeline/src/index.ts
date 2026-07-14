export { type CompositedFrame } from "./frame.js";
export {
  buildRenderTimeline,
  type RenderFrame,
  type TimelineOptions,
} from "./transitions.js";
export {
  DEFAULT_TIMINGS,
  buildVideoTimeline,
  deriveVideoEditModel,
  compileVideoModel,
  sampleTimeline,
  type VideoRenderFrame,
  type VideoTimelineOptions,
  type VideoEditModel,
  type CompiledVideoModel,
  type ZoomSegment,
  type SubtitleSegment,
  type CursorKeyframe,
  type CutSegment,
  type CropRect,
  type VideoClip,
} from "./video-timeline.js";
export {
  type ZoomRect,
  cubicInOut,
  interpolateZoom,
  computeZoomRect,
  fullViewportRect,
} from "./zoom.js";
export {
  DEFAULT_CURSOR_SIZE,
  type CursorShape,
  type CursorPlacement,
  cursorSvg,
  cursorPlacement,
  interpolateCursor,
} from "./cursor-math.js";
export { type AnnotationSvg, buildAnnotationSvg } from "./overlay-svg.js";
export {
  type ExtractRect,
  extractRect,
  cursorInFrame,
} from "./frame-geometry.js";
