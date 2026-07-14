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
  private readonly history: History<VideoEditModel>;
  // JSON of the last saved model; drives {@link dirty}. Updated on markSaved().
  private savedBaseline: string;

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
  /** True while showing a version (see {@link preview}): edits aren't "dirty". */
  previewing = $state(false);
  // Bump on every committed change so `dirty` re-evaluates reactively.
  private rev = $state(0);
  private previewBackup: VideoEditModel | null = null;

  compiled = $derived<CompiledVideoModel>(compileVideoModel(this.model));
  durationMs = $derived(this.model.durationMs);
  primaryId = $derived(this.selectedIds[0] ?? null);
  primaryKind = $derived(
    this.primaryId ? core.segmentKind(this.model, this.primaryId) : null
  );
  /** Unsaved edits exist vs the last save (ignored while previewing a version). */
  dirty = $derived.by(() => {
    void this.rev; // re-evaluate after markSaved updates the baseline
    return !this.previewing && this.modelJson() !== this.savedBaseline;
  });

  constructor(host: EditorHost) {
    this.recording = host.recording;
    this.capabilities = host.capabilities;
    // Snapshot to a plain object: the model may arrive as a Svelte state proxy
    // (host is reactive) which structuredClone cannot copy.
    const raw = host.recording.model;
    const seed = raw
      ? ($state.snapshot(raw) as VideoEditModel)
      : emptyModel(host.recording);
    this.history = new History(seed);
    this.model = seed;
    this.savedBaseline = JSON.stringify(seed);
  }

  private modelJson(): string {
    return JSON.stringify($state.snapshot(this.model));
  }

  /** Mark the current model as the saved baseline (call after persisting). */
  markSaved(): void {
    this.savedBaseline = this.modelJson();
    this.rev++;
  }

  // --- history plumbing ---------------------------------------------------

  private afterChange(): void {
    this.model = this.history.present;
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    this.selectedIds = this.selectedIds.filter(
      (id) => core.segmentKind(this.model, id) !== null
    );
  }

  /** A plain snapshot of the live model (safe to persist or version). */
  get workingModel(): VideoEditModel {
    return $state.snapshot(this.model) as VideoEditModel;
  }

  /** Replace the whole model, clearing undo history. */
  private loadModel(model: VideoEditModel): void {
    const seed = $state.snapshot(model) as VideoEditModel;
    this.history.reset(seed);
    this.model = seed;
    this.canUndo = false;
    this.canRedo = false;
    this.selectedIds = [];
  }

  /** Show a version without disturbing the working copy; undo via exitPreview. */
  preview(model: VideoEditModel): void {
    this.previewBackup ??= this.workingModel;
    this.previewing = true;
    this.loadModel(model);
  }

  exitPreview(): void {
    if (!this.previewBackup) return;
    const backup = this.previewBackup;
    this.previewBackup = null;
    this.previewing = false;
    this.loadModel(backup);
  }

  /** Adopt `model` as the new working copy, ending any preview. Caller persists. */
  restore(model: VideoEditModel): void {
    this.previewBackup = null;
    this.previewing = false;
    this.loadModel(model);
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

  addZoom(): void {
    this.addZoomAt(this.previewTimeMs);
  }

  addSubtitle(): void {
    this.addSubtitleAt(this.previewTimeMs);
  }

  /**
   * Add a zoom anchored at an output-timeline position (playhead / context menu
   * / click). Zooms and subtitles are stored in *source* time so they stick to
   * the footage when clips are split, held, or reordered — hence the map back
   * from the output timeline before inserting.
   */
  addZoomAt(timelineMs: number): void {
    const atMs = this.compiled.sourceTimeAt(timelineMs) ?? timelineMs;
    let id = "";
    this.commit((m) => (id = core.addZoom(m, atMs)));
    this.select(id);
  }

  addSubtitleAt(timelineMs: number): void {
    const atMs = this.compiled.sourceTimeAt(timelineMs) ?? timelineMs;
    let id = "";
    this.commit((m) => (id = core.addSubtitle(m, atMs)));
    this.select(id);
  }

  /** Enter focus-picking for a zoom (defaults to the selected one). */
  startPickFocus(id: string | null = this.primaryId): void {
    const zoomId =
      id && core.segmentKind(this.model, id) === "zoom" ? id : null;
    if (!zoomId) return;
    this.select(zoomId);
    this.tool = "pickFocus";
    this.pickFocusId = zoomId;
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

  /** Live focus drag (reticle on the stage): one undo step per gesture. */
  setZoomFocusLive(id: string, centerX: number, centerY: number): void {
    this.updateGesture((m) => core.setZoomFocus(m, id, centerX, centerY));
  }

  // --- export -------------------------------------------------------------

  sampledFrames(): CompositedFrame[] {
    return this.recording.model
      ? sampleTimeline(this.model)
      : this.recording.frames;
  }
}
