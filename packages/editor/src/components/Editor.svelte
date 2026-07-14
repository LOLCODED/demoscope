<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { saveWorkingEdit } from "@demoscope/browser-kit";
  import { setStore } from "../context.js";
  import { EditorStore, type EditorHost } from "../store.svelte.js";
  import type { EditorController } from "../editor-controller.js";
  import { matchBinding } from "../keymap.js";
  import Toolbar from "./Toolbar.svelte";
  import Stage from "./Stage.svelte";
  import Timeline from "./Timeline.svelte";
  import SegmentPopover from "./SegmentPopover.svelte";
  import ExportPanel from "./ExportPanel.svelte";
  import VersionsPanel from "./VersionsPanel.svelte";

  const {
    host,
    onController,
  }: { host: EditorHost; onController?: (c: EditorController) => void } =
    $props();
  // The host is fixed for the lifetime of the component (parent remounts via
  // {#key host}), so capturing it once at construction is intentional.
  const store = untrack(() => new EditorStore(host));

  // Persist the working copy on demand (explicit save — no autosave). Refreshing
  // the recording's seed model means re-entering the editor shows the saved work.
  async function persistWorking(): Promise<void> {
    const id = host.recording.id;
    if (!id) return;
    const model = store.workingModel;
    await saveWorkingEdit(id, "video", model);
    host.recording.model = model;
    store.markSaved();
  }

  onMount(() =>
    onController?.({ isDirty: () => store.dirty, save: persistWorking })
  );
  setStore(store);

  function onKey(event: KeyboardEvent): void {
    const el = event.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      return;
    if (event.key === "Escape") {
      store.tool = "none";
      store.pickFocusId = null;
      store.select(null);
      return;
    }
    const binding = matchBinding(event);
    if (!binding || binding.enabled?.(store) === false) return;
    event.preventDefault();
    binding.run(store);
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
      <ExportPanel />
      {#if host.capabilities.persistEdits && host.recording.id && host.recording.autoModel}
        <VersionsPanel
          recordingId={host.recording.id}
          kind="video"
          baseline={host.recording.autoModel}
          getCurrent={() => store.workingModel}
          onPreview={(model) => store.preview(model)}
          onExitPreview={() => store.exitPreview()}
          onRestore={(model) => {
            store.restore(model);
            void persistWorking();
          }}
          onSaved={persistWorking}
        />
      {/if}
    </aside>
  </div>
  <SegmentPopover />
</div>
