<script lang="ts">
  import { getStore } from "../context.js";
  import * as core from "../core/editor-core.js";

  const store = getStore();

  interface Seg {
    id: string;
    start: number;
    length: number;
    label: string;
    kind: "clip" | "cut" | "zoom" | "sub";
  }

  const pixelWidth = $derived(Math.max(720, (store.durationMs / 1000) * 120));
  // Measure the actual rendered lane width so click-mapping, segment layout,
  // and the playhead all share one px-per-ms. `min-width:100%` can stretch the
  // lane wider than `pixelWidth`; using the computed value there makes the
  // playhead land short of the click.
  let laneWidth = $state(0);
  const pxPerMs = $derived((laneWidth || pixelWidth) / Math.max(1, store.durationMs));

  let scrollEl = $state<HTMLDivElement>();
  // Output-time of the alignment guide shown while a drag snaps to a neighbour.
  let snapMs = $state<number | null>(null);
  // Right-click track menu (add zoom/subtitle at a point, delete a segment).
  interface TrackMenu {
    x: number;
    y: number;
    timelineMs: number;
    laneKey: string;
    segId: string | null;
  }
  let menu = $state<TrackMenu | null>(null);

  // Keep the playhead in view as it advances (playback) or is scrubbed, so the
  // timeline follows the needle instead of letting it run off-screen.
  $effect(() => {
    const x = store.previewTimeMs * pxPerMs;
    const el = scrollEl;
    if (!el) return;
    const margin = 80;
    if (x < el.scrollLeft + margin) el.scrollLeft = Math.max(0, x - margin);
    else if (x > el.scrollLeft + el.clientWidth - margin)
      el.scrollLeft = x - el.clientWidth + margin;
  });

  const clips = $derived<Seg[]>(
    store.model.clips.map((c) => ({
      id: c.id,
      start: c.timelineStartMs,
      length: core.clipDuration(c),
      label: c.holdMs ? "Video + hold" : "Video",
      kind: "clip",
    }))
  );
  const cuts = $derived<Seg[]>(
    store.model.cuts.map((c) => ({
      id: c.id,
      start: c.startMs,
      length: c.endMs - c.startMs,
      label: "Removed",
      kind: "cut",
    }))
  );
  const zooms = $derived<Seg[]>(
    store.model.zooms.map((z) => ({
      id: z.id,
      start: store.compiled.timelineTimeForSource(z.startMs),
      length: core.zoomDuration(z),
      label: z.followCursor ? `Zoom ${z.level}× ◎ follow` : `Zoom ${z.level}×`,
      kind: "zoom",
    }))
  );
  const subs = $derived<Seg[]>(
    store.model.subtitles.map((s) => ({
      id: s.id,
      start: store.compiled.timelineTimeForSource(s.startMs),
      length: s.endMs - s.startMs,
      label: s.text || "Subtitle",
      kind: "sub",
    }))
  );

  const ticks = $derived.by(() => {
    const seconds = Math.ceil(store.durationMs / 1000);
    const step = seconds > 90 ? 10 : seconds > 30 ? 5 : 1;
    const out: number[] = [];
    for (let s = 0; s <= seconds; s += step) out.push(s);
    return out;
  });

  function snapAnchors(excludeId: string): number[] {
    const all = [...clips, ...cuts, ...zooms, ...subs].filter(
      (s) => s.id !== excludeId
    );
    const anchors = [0, store.durationMs, store.previewTimeMs];
    for (const s of all) anchors.push(s.start, s.start + s.length);
    return anchors;
  }

  /** Snap a candidate ms value to a nearby anchor unless Alt is held. */
  function snap(value: number, anchors: number[], alt: boolean): number {
    if (alt) return value;
    const threshold = 6 / pxPerMs;
    let best = value;
    let bestDist = threshold;
    for (const a of anchors) {
      const d = Math.abs(a - value);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return best;
  }

  function beginDrag(event: PointerEvent, seg: Seg): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    store.select(seg.id, event.shiftKey || event.metaKey);
    const lane = (event.currentTarget as HTMLElement).parentElement!;
    const startX = event.clientX;
    const original = seg.start;
    const anchors = snapAnchors(seg.id);
    let dragging = false;
    store.beginGesture();
    const move = (e: PointerEvent) => {
      if (!dragging && Math.abs(e.clientX - startX) < 4) return;
      dragging = true;
      e.preventDefault();
      const raw = original + (e.clientX - startX) / pxPerMs;
      const snapped = snap(raw, anchors, e.altKey);
      const snappedEnd = snap(raw + seg.length, anchors, e.altKey);
      // Prefer an end-edge snap, else a start-edge snap; the guide marks whichever
      // anchor caught so the user sees exactly what they're aligning to.
      let next: number;
      if (snappedEnd !== raw + seg.length) {
        next = snappedEnd - seg.length;
        snapMs = snappedEnd;
      } else if (snapped !== raw) {
        next = snapped;
        snapMs = snapped;
      } else {
        next = raw;
        snapMs = null;
      }
      store.updateGesture((m) => core.moveSegment(m, seg.id, next));
    };
    const end = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      store.endGesture();
      snapMs = null;
      // A click (no drag) seeks the playhead to that point, like the timeline.
      if (!dragging) scrub(e, lane);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  function beginResize(event: PointerEvent, seg: Seg): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    store.select(seg.id);
    const startX = event.clientX;
    const original = seg.length;
    store.beginGesture();
    const move = (e: PointerEvent) => {
      const next = original + (e.clientX - startX) / pxPerMs;
      store.updateGesture((m) => core.setSegmentLength(m, seg.id, next));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      store.endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  let laneEls = $state<Record<string, HTMLDivElement | undefined>>({});

  function scrub(event: PointerEvent, lane: HTMLElement): void {
    const bounds = lane.getBoundingClientRect();
    store.setTime(((event.clientX - bounds.left) / bounds.width) * store.durationMs);
  }

  function lanePointerDown(event: PointerEvent, lane: HTMLElement): void {
    if (event.target instanceof HTMLElement && event.target.closest(".ds-seg"))
      return;
    if (store.playing) store.togglePlayback();
    lane.setPointerCapture(event.pointerId);
    scrub(event, lane);
    const move = (e: PointerEvent) => scrub(e, lane);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  function openMenu(event: MouseEvent, laneKey: string, lane: HTMLElement): void {
    event.preventDefault();
    const bounds = lane.getBoundingClientRect();
    const timelineMs = clampTime(
      ((event.clientX - bounds.left) / bounds.width) * store.durationMs
    );
    const seg =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>(".ds-seg")
        : null;
    menu = {
      x: event.clientX,
      y: event.clientY,
      timelineMs,
      laneKey,
      segId: seg?.dataset.segId ?? null,
    };
  }

  const clampTime = (ms: number) => Math.min(Math.max(ms, 0), store.durationMs);

  interface MenuItem {
    label: string;
    run: () => void;
  }

  const menuItems = $derived.by<MenuItem[]>(() => {
    if (!menu) return [];
    const at = menu.timelineMs;
    const items: MenuItem[] = [];
    if (menu.laneKey === "video" || menu.laneKey === "zoom")
      items.push({ label: "Add zoom here", run: () => store.addZoomAt(at) });
    if (menu.laneKey === "video" || menu.laneKey === "sub")
      items.push({
        label: "Add subtitle here",
        run: () => store.addSubtitleAt(at),
      });
    if (menu.laneKey === "video")
      items.push({ label: "Split here", run: () => splitAt(at) });
    if (menu.segId) {
      const id = menu.segId;
      items.push({
        label: "Delete",
        run: () => {
          store.select(id);
          store.deleteSelected();
        },
      });
    }
    return items;
  });

  function splitAt(timelineMs: number): void {
    store.setTime(timelineMs);
    store.split();
  }

  function runItem(item: MenuItem): void {
    item.run();
    menu = null;
  }
</script>

<div class="ds-timeline">
  <div class="ds-track-labels">
    <span class="ds-ruler-spacer"></span>
    <span>Video</span>
    <span>Zooms</span>
    <span>Subtitles</span>
  </div>
  <div class="ds-timeline-scroll" bind:this={scrollEl}>
    <div
      class="ds-timeline-inner"
      style="width:{pixelWidth}px"
      bind:clientWidth={laneWidth}
    >
      <div class="ds-ruler">
        {#each ticks as second (second)}
          <span class="ds-tick" style="left:{second * 1000 * pxPerMs}px"
            >{second}s</span
          >
        {/each}
      </div>

      {#each [{ key: "video", items: [...clips, ...cuts] }, { key: "zoom", items: zooms }, { key: "sub", items: subs }] as lane (lane.key)}
        <div
          class="ds-lane ds-lane-{lane.key}"
          bind:this={laneEls[lane.key]}
          role="presentation"
          onpointerdown={(e) => lanePointerDown(e, e.currentTarget)}
          oncontextmenu={(e) => openMenu(e, lane.key, e.currentTarget)}
        >
          {#each lane.items as seg (seg.id)}
            <button
              type="button"
              class="ds-seg ds-seg-{seg.kind}"
              class:ds-selected={store.isSelected(seg.id)}
              data-seg-id={seg.id}
              style="left:{seg.start * pxPerMs}px; width:{Math.max(
                2,
                seg.length * pxPerMs
              )}px"
              onpointerdown={(e) => beginDrag(e, seg)}
            >
              <span class="ds-seg-label">{seg.label}</span>
              {#if seg.kind !== "clip" || store.model.clips.length > 1}
                <span
                  class="ds-resize"
                  role="presentation"
                  onpointerdown={(e) => beginResize(e, seg)}
                ></span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}

      {#if snapMs !== null}
        <div class="ds-snap-guide" style="left:{snapMs * pxPerMs}px"></div>
      {/if}

      <div
        class="ds-needle"
        style="left:{store.previewTimeMs * pxPerMs}px"
      ></div>
    </div>
  </div>

  {#if menu}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="ds-menu-backdrop"
      oncontextmenu={(e) => {
        e.preventDefault();
        menu = null;
      }}
      onpointerdown={() => (menu = null)}
    ></div>
    <ul class="ds-menu" style="left:{menu.x}px; top:{menu.y}px" role="menu">
      {#each menuItems as item (item.label)}
        <li>
          <button role="menuitem" onclick={() => runItem(item)}>{item.label}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
