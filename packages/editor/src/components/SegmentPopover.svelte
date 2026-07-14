<script lang="ts">
  import { getStore } from "../context.js";
  import * as core from "../core/editor-core.js";

  const store = getStore();

  const clip = $derived(store.model.clips.find((c) => c.id === store.primaryId));
  const zoom = $derived(store.model.zooms.find((z) => z.id === store.primaryId));
  const sub = $derived(
    store.model.subtitles.find((s) => s.id === store.primaryId)
  );
  const cut = $derived(store.model.cuts.find((c) => c.id === store.primaryId));
  const active = $derived(clip ?? zoom ?? sub ?? cut);

  const toSeconds = (ms: number) => (ms / 1000).toFixed(1);
  const clamp100 = (seconds: number) => Math.max(100, Number(seconds) * 1000);

  // Anchor the popover above the selected segment's element on the timeline,
  // in fixed coordinates so the editor's scroll containers can't clip it.
  let pos = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    void store.primaryId;
    void store.compiled;
    void store.previewTimeMs;
    reposition();
  });

  $effect(() => {
    const onLayout = () => reposition();
    window.addEventListener("scroll", onLayout, true);
    window.addEventListener("resize", onLayout);
    return () => {
      window.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("resize", onLayout);
    };
  });

  function reposition(): void {
    const id = store.primaryId;
    const el = id
      ? document.querySelector<HTMLElement>(`[data-seg-id="${CSS.escape(id)}"]`)
      : null;
    if (!el) {
      pos = null;
      return;
    }
    const r = el.getBoundingClientRect();
    pos = { left: r.left + r.width / 2, top: r.top };
  }

  function setClipHold(seconds: string): void {
    store.commit((m) => {
      const c = m.clips.find((x) => x.id === store.primaryId);
      if (!c) return;
      c.holdMs = Math.max(0, clamp100(seconds));
      core.syncTimelineDuration(m);
    });
  }

  function setZoomLevelLive(value: number): void {
    store.updateGesture((m) => {
      const z = m.zooms.find((x) => x.id === store.primaryId);
      if (z) z.level = value;
    });
  }

  function setZoomDuration(seconds: string): void {
    store.commit((m) => {
      const z = m.zooms.find((x) => x.id === store.primaryId);
      if (z) core.setZoomDuration(z, clamp100(seconds));
    });
  }

  function setZoomFollow(follow: boolean): void {
    store.commit((m) => {
      const z = m.zooms.find((x) => x.id === store.primaryId);
      if (z) z.followCursor = follow;
    });
  }

  function setSubText(text: string): void {
    store.commit((m) => {
      const s = m.subtitles.find((x) => x.id === store.primaryId);
      if (s) s.text = text;
    });
  }

  function setSubDuration(seconds: string): void {
    store.commit((m) => {
      const s = m.subtitles.find((x) => x.id === store.primaryId);
      if (s) s.endMs = s.startMs + clamp100(seconds);
    });
  }
</script>

{#if active && pos}
  <div
    class="ds-popover"
    style="left:{pos.left}px; top:{pos.top}px"
    role="dialog"
    aria-label="Edit segment"
  >
    {#if clip}
      <div class="ds-popover-head">
        <h3>Video clip</h3>
        <button
          class="ds-btn-ghost"
          aria-label="Deselect"
          onclick={() => store.select(null)}>✕</button
        >
      </div>
      <label class="ds-field">
        Hold
        <span class="ds-field-row">
          <input
            type="number"
            min="0"
            step="0.1"
            value={toSeconds(clip.holdMs)}
            onchange={(e) => setClipHold(e.currentTarget.value)}
          />
          <span>s</span>
        </span>
      </label>
      <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}>Remove</button>
    {:else if zoom}
      <div class="ds-popover-head">
        <h3>Zoom</h3>
        <button
          class="ds-btn-ghost"
          aria-label="Deselect"
          onclick={() => store.select(null)}>✕</button
        >
      </div>
      <label class="ds-field">
        Strength {zoom.level.toFixed(2)}×
        <input
          type="range"
          min="1"
          max="4"
          step="0.25"
          value={zoom.level}
          onpointerdown={() => store.beginGesture()}
          oninput={(e) => setZoomLevelLive(Number(e.currentTarget.value))}
          onpointerup={() => store.endGesture()}
          onchange={() => store.endGesture()}
        />
      </label>
      <label class="ds-field">
        Duration
        <span class="ds-field-row">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={toSeconds(core.zoomDuration(zoom))}
            onchange={(e) => setZoomDuration(e.currentTarget.value)}
          />
          <span>s</span>
        </span>
      </label>
      <label class="ds-field-check">
        <input
          type="checkbox"
          checked={zoom.followCursor ?? false}
          onchange={(e) => setZoomFollow(e.currentTarget.checked)}
        />
        Follow cursor
      </label>
      {#if zoom.followCursor}
        <p class="ds-popover-hint">
          The zoom pans to keep the moving cursor centered.
        </p>
      {:else}
        <p class="ds-popover-hint">
          Drag the ◎ target on the preview to aim the zoom.
        </p>
      {/if}
      <div class="ds-popover-actions">
        {#if !zoom.followCursor}
          <button
            class="ds-btn-secondary"
            class:ds-active={store.pickFocusId === zoom.id}
            onclick={() => store.startPickFocus(zoom.id)}
          >
            {store.pickFocusId === zoom.id ? "Click preview…" : "Pick focus"}
          </button>
        {/if}
        <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}>Remove</button>
      </div>
    {:else if sub}
      <div class="ds-popover-head">
        <h3>Subtitle</h3>
        <button
          class="ds-btn-ghost"
          aria-label="Deselect"
          onclick={() => store.select(null)}>✕</button
        >
      </div>
      <label class="ds-field">
        Text
        <input
          type="text"
          value={sub.text}
          placeholder="Subtitle text"
          onchange={(e) => setSubText(e.currentTarget.value)}
        />
      </label>
      <label class="ds-field">
        Duration
        <span class="ds-field-row">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={toSeconds(sub.endMs - sub.startMs)}
            onchange={(e) => setSubDuration(e.currentTarget.value)}
          />
          <span>s</span>
        </span>
      </label>
      <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}>Remove</button>
    {:else if cut}
      <div class="ds-popover-head">
        <h3>Removed {toSeconds(cut.endMs - cut.startMs)}s</h3>
        <button
          class="ds-btn-ghost"
          aria-label="Deselect"
          onclick={() => store.select(null)}>✕</button
        >
      </div>
      <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}>Restore</button>
    {/if}
    <span class="ds-popover-arrow"></span>
  </div>
{/if}
