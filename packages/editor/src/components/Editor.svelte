<script lang="ts">
  import { untrack } from "svelte";
  import { setStore } from "../context.js";
  import { EditorStore, type EditorHost } from "../store.svelte.js";
  import Toolbar from "./Toolbar.svelte";
  import Stage from "./Stage.svelte";
  import Timeline from "./Timeline.svelte";
  import Inspector from "./Inspector.svelte";
  import ExportPanel from "./ExportPanel.svelte";

  const { host }: { host: EditorHost } = $props();
  // The host is fixed for the lifetime of the component (parent remounts via
  // {#key host}), so capturing it once at construction is intentional.
  const store = untrack(() => new EditorStore(host));
  setStore(store);

  function onKey(event: KeyboardEvent): void {
    const el = event.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      return;
    const meta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (meta && key === "z") {
      event.preventDefault();
      event.shiftKey ? store.redo() : store.undo();
    } else if (meta && key === "b") {
      event.preventDefault();
      store.split();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      store.deleteSelected();
    } else if (event.key === " ") {
      event.preventDefault();
      store.togglePlayback();
    } else if (event.key === "[") {
      store.markIn();
    } else if (event.key === "]") {
      store.markOut();
    } else if (event.key === "Escape") {
      store.tool = "none";
      store.pickFocusId = null;
      store.select(null);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="ds-editor">
  <Toolbar />
  <div class="ds-editor-body">
    <div class="ds-editor-main">
      <Stage />
      <Timeline />
    </div>
    <aside class="ds-editor-side">
      <Inspector />
      <ExportPanel />
    </aside>
  </div>
</div>
