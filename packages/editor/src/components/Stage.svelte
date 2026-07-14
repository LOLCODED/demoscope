<script lang="ts">
  import { untrack } from "svelte";
  import {
    CanvasCompositor,
    VideoSeekFrameSource,
    type OutputDims,
  } from "@demoscope/browser-kit";
  import type { CropRect } from "@demoscope/timeline";
  import { getStore } from "../context.js";
  import { nextPlayableTime } from "../core/editor-core.js";

  const store = getStore();
  const dims: OutputDims = store.recording.dims;

  let holder = $state<HTMLDivElement>();
  let stageEl = $state<HTMLDivElement>();
  let compositor: CanvasCompositor | null = null;
  let renderVersion = 0;

  // Focus reticle: shown over the preview whenever a zoom is selected, so the
  // focus point is a visible thing you drag rather than a hidden click target.
  const selectedZoom = $derived(
    store.model.zooms.find((z) => z.id === store.primaryId)
  );
  let reticle = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    void store.compiled;
    void store.previewTimeMs;
    void store.primaryId;
    void store.tool;
    reticle = computeReticle();
  });

  // The reticle is placed off the live canvas rect, so recompute when the layout
  // (not the model) shifts under it.
  $effect(() => {
    const onResize = () => (reticle = computeReticle());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  // Crop drag state (screen-space rectangle over the canvas).
  let dragRect = $state<{ x: number; y: number; w: number; h: number } | null>(
    null
  );
  let dragStart: { x: number; y: number } | null = null;

  $effect(() => {
    const rec = store.recording;
    const created = new CanvasCompositor({
      sourceWidth: rec.source.width,
      sourceHeight: dims.sourceContentHeight,
      scale: dims.scale,
      sourceTop: dims.sourceTop,
      outputWidth: dims.outputWidth,
      outputHeight: dims.outputHeight,
    });
    let disposed = false;
    void created.init().then(() => {
      if (disposed) return;
      compositor = created;
      holder?.replaceChildren(created.canvas);
      void renderFrame();
    });
    return () => {
      disposed = true;
    };
  });

  // Re-render whenever the compiled model or playhead changes — but not during
  // playback, where the playback loop below owns drawing.
  $effect(() => {
    void store.compiled;
    void store.previewTimeMs;
    if (store.playing) return;
    void renderFrame();
  });

  // Playback loop. Depends only on `store.playing`; all reactive reads happen
  // inside untrack / rAF callbacks so changing the playhead doesn't restart it.
  $effect(() => {
    if (!store.playing) return;
    return untrack(() => {
      let cancelled = false;
      let raf = 0;
      const source = store.recording.source;
      const video =
        source instanceof VideoSeekFrameSource ? source.element : null;

      // Timeline time is the master clock; the source frame (and whether we're
      // playing a clip or frozen on a freeze-hold) is derived from it. Driving
      // off the video's own clock instead can't represent a hold — one source
      // time maps to a whole timeline range — so holds were skipped.
      const startVideo = () => {
        if (!video || !compositor) return;
        let last = performance.now();
        let timelineMs =
          store.previewTimeMs >= store.durationMs ? 0 : store.previewTimeMs;

        const loop = async () => {
          if (cancelled || !store.playing) return;
          const now = performance.now();
          timelineMs = Math.min(timelineMs + (now - last), store.durationMs);
          last = now;

          const compiled = store.compiled;
          let sourceMs = compiled.sourceTimeAt(timelineMs) ?? 0;

          // Non-destructive cuts live on the source timeline; skip over one the
          // playhead lands inside so removed footage never plays.
          const cut = store.model.cuts.find(
            (c) => sourceMs >= c.startMs && sourceMs < c.endMs
          );
          if (cut) {
            timelineMs = Math.min(
              compiled.timelineTimeForSource(cut.endMs),
              store.durationMs
            );
            sourceMs = compiled.sourceTimeAt(timelineMs) ?? cut.endMs;
          }
          store.previewTimeMs = timelineMs;

          // Advancing (real playback) vs holding, told apart by whether the
          // source time is still moving a beat ahead on the timeline.
          const aheadMs =
            compiled.sourceTimeAt(Math.min(timelineMs + 50, store.durationMs)) ??
            sourceMs;
          if (aheadMs - sourceMs > 1) {
            if (video.paused) {
              try {
                await video.play();
              } catch {
                /* play() can reject on a seek race; the loop recovers */
              }
            }
            if (Math.abs(video.currentTime * 1000 - sourceMs) > 80)
              video.currentTime = sourceMs / 1000;
          } else {
            // Freeze-hold (or cut edge): pin the video on the held frame.
            if (!video.paused) video.pause();
            if (Math.abs(video.currentTime * 1000 - sourceMs) > 15)
              video.currentTime = sourceMs / 1000;
          }

          await compositor.drawFrame(compiled.frameAt(timelineMs), video);

          if (timelineMs >= store.durationMs) {
            store.stopPlayback();
            return;
          }
          raf = requestAnimationFrame(() => void loop());
        };

        raf = requestAnimationFrame(() => void loop());
      };

      // Non-video sources (screenshots): advance on the wall clock.
      const startTimer = () => {
        const startPerf = performance.now();
        const startTime = store.previewTimeMs;
        const loop = async () => {
          if (cancelled || !store.playing) return;
          const raw = Math.min(
            performance.now() - startPerf + startTime,
            store.durationMs
          );
          store.previewTimeMs = nextPlayableTime(store.model, raw);
          await renderFrame();
          if (store.previewTimeMs >= store.durationMs) {
            store.stopPlayback();
            return;
          }
          raf = requestAnimationFrame(() => void loop());
        };
        raf = requestAnimationFrame(() => void loop());
      };

      if (video) void startVideo();
      else startTimer();

      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        video?.pause();
      };
    });
  });

  async function renderFrame(): Promise<void> {
    if (!compositor) return;
    const version = ++renderVersion;
    const compiled = store.compiled;
    const t = Math.min(Math.max(store.previewTimeMs, 0), compiled.durationMs);
    const sourceTime = compiled.sourceTimeAt(t);
    if (sourceTime === undefined) return;
    const image = await store.recording.source.get(sourceTime);
    if (version !== renderVersion) return;
    await compositor.drawFrame(compiled.frameAt(t), image);
  }

  function canvasRect(): DOMRect | null {
    return compositor?.canvas.getBoundingClientRect() ?? null;
  }

  /** Position the reticle over the selected zoom's focus point (stage-relative). */
  function computeReticle(): { left: number; top: number } | null {
    const zoom = selectedZoom;
    if (!zoom || zoom.followCursor || store.tool === "crop" || !compositor || !stageEl)
      return null;
    const canvas = compositor.canvas.getBoundingClientRect();
    const stage = stageEl.getBoundingClientRect();
    const frame = store.compiled.frameAt(store.previewTimeMs).zoomRect;
    const x = ((zoom.centerX - frame.x) / frame.w) * canvas.width;
    const y = ((zoom.centerY - frame.y) / frame.h) * canvas.height;
    return { left: canvas.left - stage.left + x, top: canvas.top - stage.top + y };
  }

  /** Map a screen point over the canvas to source-viewport focus coordinates. */
  function focusFromEvent(event: PointerEvent): { x: number; y: number } | null {
    const bounds = canvasRect();
    if (!bounds) return null;
    const frame = store.compiled.frameAt(store.previewTimeMs).zoomRect;
    return {
      x: frame.x + ((event.clientX - bounds.left) / bounds.width) * frame.w,
      y: frame.y + ((event.clientY - bounds.top) / bounds.height) * frame.h,
    };
  }

  function beginReticleDrag(event: PointerEvent): void {
    const zoom = selectedZoom;
    if (!zoom) return;
    event.stopPropagation();
    event.preventDefault();
    store.beginGesture();
    const moveTo = (e: PointerEvent) => {
      const focus = focusFromEvent(e);
      if (focus) store.setZoomFocusLive(zoom.id, focus.x, focus.y);
    };
    moveTo(event);
    const up = () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", up);
      store.endGesture();
    };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", up, { once: true });
  }

  /** Map a screen rectangle over the canvas into viewport crop coordinates. */
  function toCrop(
    left: number,
    top: number,
    width: number,
    height: number,
    bounds: DOMRect
  ): CropRect {
    const frame = store.compiled.frameAt(store.previewTimeMs).zoomRect;
    return {
      x: frame.x + (left / bounds.width) * frame.w,
      y: frame.y + (top / bounds.height) * frame.h,
      width: (width / bounds.width) * frame.w,
      height: (height / bounds.height) * frame.h,
    };
  }

  function onPointerDown(event: PointerEvent): void {
    const bounds = canvasRect();
    if (!bounds || event.target !== compositor?.canvas) return;
    if (store.tool === "pickFocus" && store.pickFocusId) {
      const focus = focusFromEvent(event);
      if (focus) store.setZoomFocus(store.pickFocusId, focus.x, focus.y);
      return;
    }
    if (store.tool === "crop") {
      dragStart = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      dragRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
      store.beginCrop();
      compositor.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (store.tool !== "crop" || !dragStart) return;
    const bounds = canvasRect();
    if (!bounds) return;
    const x = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const y = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height);
    const rect = {
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      w: Math.abs(x - dragStart.x),
      h: Math.abs(y - dragStart.y),
    };
    dragRect = rect;
    if (rect.w > 8 && rect.h > 8)
      store.updateCrop(toCrop(rect.x, rect.y, rect.w, rect.h, bounds));
  }

  function onPointerUp(): void {
    if (store.tool !== "crop" || !dragStart) return;
    dragStart = null;
    dragRect = null;
    store.endCrop();
  }
</script>

<div
  class="ds-stage"
  class:ds-picking={store.tool !== "none"}
  role="presentation"
  bind:this={stageEl}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
>
  <div class="ds-canvas-holder" bind:this={holder}></div>
  {#if dragRect}
    <div
      class="ds-crop-box"
      style="left:{dragRect.x}px; top:{dragRect.y}px; width:{dragRect.w}px; height:{dragRect.h}px"
    ></div>
  {/if}
  {#if reticle}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="ds-focus-reticle"
      class:ds-active={store.pickFocusId === selectedZoom?.id}
      style="left:{reticle.left}px; top:{reticle.top}px"
      title="Drag to set the zoom focus"
      onpointerdown={beginReticleDrag}
    >
      <span class="ds-focus-label">Zoom focus</span>
    </div>
  {/if}
  {#if store.tool === "crop"}
    <p class="ds-stage-hint">Drag on the preview to reframe · Esc to cancel</p>
  {:else if store.tool === "pickFocus"}
    <p class="ds-stage-hint">Click the preview to move the zoom focus · Esc to finish</p>
  {:else if selectedZoom && !selectedZoom.followCursor}
    <p class="ds-stage-hint">Drag the ◎ target to aim the zoom</p>
  {/if}
</div>
