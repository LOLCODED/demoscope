<script lang="ts">
  import { getStore } from "../context.js";
  import * as core from "../core/editor-core.js";

  const store = getStore();

  const clip = $derived(
    store.model.clips.find((c) => c.id === store.primaryId)
  );
  const zoom = $derived(store.model.zooms.find((z) => z.id === store.primaryId));
  const sub = $derived(
    store.model.subtitles.find((s) => s.id === store.primaryId)
  );
  const cut = $derived(store.model.cuts.find((c) => c.id === store.primaryId));

  const toSeconds = (ms: number) => (ms / 1000).toFixed(1);
  const clamp100 = (seconds: number) => Math.max(100, Number(seconds) * 1000);

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

  function pickFocus(): void {
    if (!zoom) return;
    store.tool = "pickFocus";
    store.pickFocusId = zoom.id;
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

{#if clip}
  <div class="ds-inspector">
    <h3>Video clip</h3>
    <label class="ds-field">
      Hold
      <input
        type="number"
        min="0"
        step="0.1"
        value={toSeconds(clip.holdMs)}
        onchange={(e) => setClipHold(e.currentTarget.value)}
      />
      <span>s</span>
    </label>
    <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}
      >Remove</button
    >
  </div>
{:else if zoom}
  <div class="ds-inspector">
    <h3>Zoom</h3>
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
      <input
        type="number"
        min="0.1"
        step="0.1"
        value={toSeconds(core.zoomDuration(zoom))}
        onchange={(e) => setZoomDuration(e.currentTarget.value)}
      />
      <span>s</span>
    </label>
    <button class="ds-btn-secondary" onclick={pickFocus}>
      {store.pickFocusId === zoom.id ? "Click preview…" : "Pick focus"}
    </button>
    <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}
      >Remove</button
    >
  </div>
{:else if sub}
  <div class="ds-inspector">
    <h3>Subtitle</h3>
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
      <input
        type="number"
        min="0.1"
        step="0.1"
        value={toSeconds(sub.endMs - sub.startMs)}
        onchange={(e) => setSubDuration(e.currentTarget.value)}
      />
      <span>s</span>
    </label>
    <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}
      >Remove</button
    >
  </div>
{:else if cut}
  <div class="ds-inspector">
    <h3>Removed {toSeconds(cut.endMs - cut.startMs)}s</h3>
    <button class="ds-btn-ghost" onclick={() => store.deleteSelected()}
      >Remove</button
    >
  </div>
{:else}
  <div class="ds-inspector ds-inspector-empty">
    <p>Select a clip, zoom, or subtitle to edit it.</p>
  </div>
{/if}
