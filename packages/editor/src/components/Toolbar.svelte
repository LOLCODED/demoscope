<script lang="ts">
  import { getStore } from "../context.js";
  import { shortcutLabel } from "../keymap.js";
  import { tooltip } from "../tooltip.js";
  import ShortcutsHelp from "./ShortcutsHelp.svelte";

  const store = getStore();
  const tip = (label: string, id: string) => ({ key: shortcutLabel(id), label });

  const markLabel = $derived.by(() => {
    const parts = [store.markInMs, store.markOutMs]
      .filter((v): v is number => v !== null)
      .map((v) => `${(v / 1000).toFixed(1)}s`);
    return parts.length ? parts.join(" → ") : "";
  });
</script>

<div class="ds-toolbar">
  <div class="ds-toolbar-group">
    <!-- Disabled buttons don't fire hover events, so the tooltip lives on a
         wrapper span that does — keeping the hint available while greyed out. -->
    <span
      class="ds-tip-wrap"
      use:tooltip={{ key: shortcutLabel("undo"), label: "Undo" }}
    >
      <button
        class="ds-btn-icon"
        aria-label="Undo"
        disabled={!store.canUndo}
        onclick={() => store.undo()}>↶</button
      >
    </span>
    <span
      class="ds-tip-wrap"
      use:tooltip={{ key: shortcutLabel("redo"), label: "Redo" }}
    >
      <button
        class="ds-btn-icon"
        aria-label="Redo"
        disabled={!store.canRedo}
        onclick={() => store.redo()}>↷</button
      >
    </span>
  </div>

  <div class="ds-toolbar-group">
    <button
      class="ds-btn-primary"
      use:tooltip={tip("Play / pause", "playPause")}
      onclick={() => store.togglePlayback()}
    >
      {store.playing ? "❚❚ Pause" : "▶ Play"}
    </button>
    <button
      class="ds-btn"
      use:tooltip={tip("Split at playhead", "split")}
      onclick={() => store.split()}>Split</button
    >
  </div>

  <div class="ds-toolbar-group">
    <button
      class="ds-btn"
      use:tooltip={tip("Add zoom at playhead", "addZoom")}
      onclick={() => store.addZoom()}>+ Zoom</button
    >
    <button
      class="ds-btn"
      use:tooltip={tip("Add subtitle at playhead", "addSubtitle")}
      onclick={() => store.addSubtitle()}>+ Subtitle</button
    >
  </div>

  <div class="ds-toolbar-group">
    <button
      class="ds-btn"
      use:tooltip={tip("Mark in", "markIn")}
      onclick={() => store.markIn()}>Mark in</button
    >
    <button
      class="ds-btn"
      use:tooltip={tip("Mark out", "markOut")}
      onclick={() => store.markOut()}>Mark out</button
    >
    <span
      class="ds-tip-wrap"
      use:tooltip={tip("Remove marked range", "removeRange")}
    >
      <button
        class="ds-btn"
        disabled={store.markInMs === null || store.markOutMs === null}
        onclick={() => store.removeMarkedRange()}
      >
        {markLabel ? `Remove ${markLabel}` : "Remove range"}
      </button>
    </span>
  </div>

  <div class="ds-toolbar-group">
    <button
      class="ds-btn"
      class:ds-active={store.tool === "crop"}
      use:tooltip={tip("Crop", "crop")}
      onclick={() => (store.tool = store.tool === "crop" ? "none" : "crop")}
      >Crop</button
    >
    <span class="ds-tip-wrap" use:tooltip={{ label: "Reset crop" }}>
      <button
        class="ds-btn"
        disabled={!store.model.crop}
        onclick={() => store.resetCrop()}>Reset crop</button
      >
    </span>
  </div>

  <div class="ds-toolbar-group ds-toolbar-end">
    <ShortcutsHelp />
  </div>
</div>
