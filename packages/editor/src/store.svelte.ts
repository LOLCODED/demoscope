import {
  compileVideoModel,
  sampleTimeline,
  type CompiledVideoModel,
  type CompositedFrame,
  type CropRect,
  type VideoEditModel,
} from "@demoscope/timeline";
import type { Capabilities, LoadedRecording } from "@demoscope/browser-kit";
import { History } from "./core/history.js";
import * as core from "./core/editor-core.js";

export type Tool = "none" | "crop" | "pickFocus";

/** Everything the surrounding host (web app / extension) must provide. */
export interface EditorHost {
  recording: LoadedRecording;
  capabilities: Capabilities;
  /** Persist edits (extension only); web app leaves this undefined. */
  onModelChange?: (model: VideoEditModel) => void;
}

const emptyModel = (rec: LoadedRecording): VideoEditModel => ({
  durationMs: Math.max(1, rec.dims.outputWidth),
  viewport: { width: rec.source.width, height: rec.source.height },
  fps: rec.fps,
  cursorGlideMs: 400,
  zooms: [],
  subtitles: [],
  cursors: [],
  cuts: [],
  clips: [],
});

/**
 * The single reactive owner of editor state: the edit model (behind an
 * undo/redo history), the current selection, playhead, and active tool.
 * Components read `$derived` values off this and call its methods, which route
 * every change through {@link core} so the logic stays testable and DOM-free.
 */
export class EditorStore {
  readonly recording: LoadedRecording;
  readonly capabilities: Capabilities;
  private readonly onModelChange?: (model: VideoEditModel) => void;
  private readonly history: History<VideoEditModel>;

  model = $state<VideoEditModel>(null!);
  selectedIds = $state<string[]>([]);
  previewTimeMs = $state(0);
  playing = $state(false);
  tool = $state<Tool>("none");
  pickFocusId = $state<string | null>(null);
  markInMs = $state<number | null>(null);
  markOutMs = $state<number | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);

  compiled = $derived<CompiledVideoModel>(compileVideoModel(this.model));
  durationMs = $derived(this.model.durationMs);
  primaryId = $derived(this.selectedIds[0] ?? null);
  primaryKind = $derived(
    this.primaryId ? core.segmentKind(this.model, this.primaryId) : null
  );

  constructor(host: EditorHost) {
    this.recording = host.recording;
    this.capabilities = host.capabilities;
    this.onModelChange = host.onModelChange;
    // Snapshot to a plain object: the model may arrive as a Svelte state proxy
    // (host is reactive) which structuredClone cannot copy.
    const raw = host.recording.model;
    const seed = raw
      ? ($state.snapshot(raw) as VideoEditModel)
      : emptyModel(host.recording);
    this.history = new History(seed);
    this.model = seed;
  }

  // --- history plumbing ---------------------------------------------------

  private afterChange(): void {
    this.model = this.history.present;
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    this.selectedIds = this.selectedIds.filter(
      (id) => core.segmentKind(this.model, id) !== null
    );
    this.onModelChange?.(this.model);
  }

  commit(mutate: (model: VideoEditModel) => void): void {
    this.history.commit(mutate);
    this.afterChange();
  }

  beginGesture(): void {
    this.history.begin();
  }

  updateGesture(mutate: (model: VideoEditModel) => void): void {
    this.model = this.history.update(mutate);
  }

  endGesture(): void {
    this.history.end();
    this.afterChange();
  }

  undo(): void {
    if (this.history.undo()) this.afterChange();
  }

  redo(): void {
    if (this.history.redo()) this.afterChange();
  }

  // --- selection + playhead ----------------------------------------------

  select(id: string | null, additive = false): void {
    if (id === null) this.selectedIds = [];
    else if (additive)
      this.selectedIds = this.selectedIds.includes(id)
        ? this.selectedIds.filter((s) => s !== id)
        : [...this.selectedIds, id];
    else this.selectedIds = [id];
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  setTime(ms: number): void {
    this.previewTimeMs = core.clamp(ms, 0, this.durationMs);
  }

  /**
   * Toggle play state only. The Stage owns the actual playback loop so it can
   * drive the `<video>` element natively (seeking per-frame stalls preview).
   */
  togglePlayback(): void {
    if (this.playing) {
      this.playing = false;
      return;
    }
    if (this.previewTimeMs >= this.durationMs) this.previewTimeMs = 0;
    this.playing = true;
  }

  stopPlayback(): void {
    this.playing = false;
  }

  // --- edit operations (each one undoable) --------------------------------

  /**
   * Zooms/subtitles are anchored in source time (so they stick to the footage
   * when clips are split, held, or reordered). Convert the playhead — which is
   * output-timeline time — before adding, or they'd land at the wrong moment
   * once the timeline no longer maps 1:1 to the source.
   */
  private get playheadSourceMs(): number {
    return this.compiled.sourceTimeAt(this.previewTimeMs) ?? this.previewTimeMs;
  }

  addZoom(): void {
    const atMs = this.playheadSourceMs;
    let id = "";
    this.commit((m) => (id = core.addZoom(m, atMs)));
    this.select(id);
  }

  addSubtitle(): void {
    const atMs = this.playheadSourceMs;
    let id = "";
    this.commit((m) => (id = core.addSubtitle(m, atMs)));
    this.select(id);
  }

  split(): void {
    let id: string | null = null;
    this.commit((m) => (id = core.splitAtPlayhead(m, this.previewTimeMs)));
    if (id) this.select(id);
  }

  deleteSelected(): void {
    const ids = this.selectedIds;
    if (ids.length === 0) return;
    this.commit((m) => ids.forEach((id) => core.deleteSegment(m, id)));
    this.selectedIds = [];
  }

  markIn(): void {
    this.markInMs = this.previewTimeMs;
  }

  markOut(): void {
    this.markOutMs = this.previewTimeMs;
  }

  removeMarkedRange(): void {
    if (this.markInMs === null || this.markOutMs === null) return;
    const inMs = this.markInMs;
    const outMs = this.markOutMs;
    let id: string | null = null;
    this.commit((m) => (id = core.removeMarkedRange(m, inMs, outMs)));
    this.markInMs = null;
    this.markOutMs = null;
    if (id) this.select(id);
  }

  setCrop(crop: CropRect): void {
    this.commit((m) => core.setCrop(m, crop));
  }

  /** Live-preview crop drag: one undo step for the whole gesture. */
  beginCrop(): void {
    this.beginGesture();
  }

  updateCrop(crop: CropRect): void {
    this.updateGesture((m) => core.setCrop(m, crop));
  }

  endCrop(): void {
    this.endGesture();
    this.tool = "none";
  }

  resetCrop(): void {
    this.commit((m) => core.resetCrop(m));
    this.tool = "none";
  }

  setZoomFocus(id: string, centerX: number, centerY: number): void {
    this.commit((m) => core.setZoomFocus(m, id, centerX, centerY));
    this.pickFocusId = null;
    this.tool = "none";
  }

  // --- export -------------------------------------------------------------

  sampledFrames(): CompositedFrame[] {
    return this.recording.model
      ? sampleTimeline(this.model)
      : this.recording.frames;
  }
}
