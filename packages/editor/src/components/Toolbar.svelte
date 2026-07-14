<script lang="ts">
  import { getStore } from "../context.js";

  const store = getStore();

  const markLabel = $derived.by(() => {
    const parts = [store.markInMs, store.markOutMs]
      .filter((v): v is number => v !== null)
      .map((v) => `${(v / 1000).toFixed(1)}s`);
    return parts.length ? parts.join(" → ") : "";
  });
</script>

<div class="ds-toolbar">
  <div class="ds-toolbar-group">
    <button
      class="ds-btn-icon"
      title="Undo (⌘Z)"
      disabled={!store.canUndo}
      onclick={() => store.undo()}>↶</button
    >
    <button
      class="ds-btn-icon"
      title="Redo (⌘⇧Z)"
      disabled={!store.canRedo}
      onclick={() => store.redo()}>↷</button
    >
  </div>

  <div class="ds-toolbar-group">
    <button class="ds-btn-primary" onclick={() => store.togglePlayback()}>
      {store.playing ? "❚❚ Pause" : "▶ Play"}
    </button>
    <button class="ds-btn" title="Split at playhead (⌘B)" onclick={() => store.split()}
      >Split</button
    >
  </div>

  <div class="ds-toolbar-group">
    <button class="ds-btn" onclick={() => store.addZoom()}>+ Zoom</button>
    <button class="ds-btn" onclick={() => store.addSubtitle()}>+ Subtitle</button>
  </div>

  <div class="ds-toolbar-group">
    <button class="ds-btn" onclick={() => store.markIn()}>Mark in</button>
    <button class="ds-btn" onclick={() => store.markOut()}>Mark out</button>
    <button
      class="ds-btn"
      disabled={store.markInMs === null || store.markOutMs === null}
      onclick={() => store.removeMarkedRange()}
    >
      {markLabel ? `Remove ${markLabel}` : "Remove range"}
    </button>
  </div>

  <div class="ds-toolbar-group">
    <button
      class="ds-btn"
      class:ds-active={store.tool === "crop"}
      onclick={() => (store.tool = store.tool === "crop" ? "none" : "crop")}
      >Crop</button
    >
    <button
      class="ds-btn"
      disabled={!store.model.crop}
      onclick={() => store.resetCrop()}>Reset crop</button
    >
  </div>
</div>
