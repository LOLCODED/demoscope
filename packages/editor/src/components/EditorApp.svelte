<script lang="ts">
  import {
    detectCapabilities,
    deleteRecording,
    getActiveRecordingId,
    listRecordings,
    loadActiveRecording,
    renameRecording,
    selectRecording,
    type LoadedRecording,
    type RecordingListItem,
    type Surface,
  } from "@demoscope/browser-kit";
  import type { EditorController } from "../editor-controller.js";
  import { tourSeen, type TourKind } from "../tour.js";
  import { ThemeController } from "../theme.svelte.js";
  import Editor from "./Editor.svelte";
  import DocumentView from "./DocumentView.svelte";
  import RecordingLibrary from "./RecordingLibrary.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import Tour from "./Tour.svelte";

  const { surface = "extension" }: { surface?: Surface } = $props();
  const theme = new ThemeController();

  type View = "browse" | "video" | "document";
  let view = $state<View>("browse");
  let recordings = $state<RecordingListItem[]>([]);
  let loaded = $state<LoadedRecording | null>(null);
  let activeId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const canPersist = $derived(surface === "extension");

  const host = $derived(
    loaded
      ? {
          recording: loaded,
          capabilities: detectCapabilities(surface, {
            hasVideo: loaded.mode === "video",
            canRecord: true,
            persistEdits: canPersist,
          }),
        }
      : null
  );

  // The active editor registers a controller so the shell can guard navigation:
  // ask whether there are unsaved edits, and persist them on request.
  let controller = $state<EditorController | null>(null);
  let leaveGuard = $state<null | { proceed: () => void | Promise<void> }>(null);
  let saving = $state(false);

  /** Run `proceed`, but prompt to save first if the editor has unsaved edits. */
  async function guardLeave(proceed: () => void | Promise<void>): Promise<void> {
    if (controller?.isDirty()) leaveGuard = { proceed };
    else await proceed();
  }

  async function saveAndLeave(): Promise<void> {
    saving = true;
    try {
      await controller?.save();
    } finally {
      saving = false;
    }
    await finishLeave();
  }

  async function finishLeave(): Promise<void> {
    const guard = leaveGuard;
    leaveGuard = null;
    await guard?.proceed();
  }

  const toBrowse = () => {
    controller = null;
    view = "browse";
  };
  const goBrowse = () => guardLeave(toBrowse);
  const openGuarded = (id: string) => guardLeave(() => open(id));

  // Warn before a tab close / reload drops unsaved edits (native prompt only).
  $effect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller?.isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  });

  // Guided tour: auto-open the first time each editor mode is entered; the ?
  // button in the app bar replays it on demand.
  let tourKind = $state<TourKind | null>(null);
  $effect(() => {
    if ((view === "video" || view === "document") && !tourSeen(view))
      tourKind = view;
  });
  const replayTour = () => {
    if (view === "video" || view === "document") tourKind = view;
  };

  void init();

  async function init(): Promise<void> {
    try {
      activeId = (await getActiveRecordingId()) ?? null;
      loaded = await loadActiveRecording();
      recordings = await listRecordings();
    } catch (err) {
      error = (err as Error)?.message ?? String(err);
    } finally {
      loading = false;
    }
  }

  async function open(id: string): Promise<void> {
    controller = null;
    loading = true;
    view = "browse";
    try {
      loaded?.source.dispose();
      loaded = null;
      await selectRecording(id);
      activeId = id;
      loaded = await loadActiveRecording();
      recordings = await listRecordings();
    } catch (err) {
      error = (err as Error)?.message ?? String(err);
    } finally {
      loading = false;
    }
  }

  async function rename(id: string, title: string): Promise<void> {
    await renameRecording(id, title);
    recordings = await listRecordings();
  }

  async function remove(id: string): Promise<void> {
    await deleteRecording(id);
    recordings = await listRecordings();
    if (activeId !== id) return;
    const next = recordings[0];
    if (next) {
      await open(next.id);
    } else {
      loaded?.source.dispose();
      loaded = null;
      activeId = null;
    }
  }
</script>

<div class="ds-app" data-ds-theme={theme.effective}>
  <header class="ds-app-bar">
    {#if view !== "browse"}
      <button class="ds-btn" onclick={() => void goBrowse()}>← Change mode</button
      >
    {/if}
    <strong class="ds-app-title">{loaded?.title ?? "Demoscope"}</strong>
    <span class="ds-app-spacer"></span>
    {#if view !== "browse"}
      <button
        class="ds-btn-icon"
        title="Replay guided tour"
        aria-label="Replay guided tour"
        onclick={replayTour}>?</button
      >
    {/if}
    <ThemeToggle {theme} />
  </header>

  <div class="ds-app-body">
    {#if loading}
      <p class="ds-app-msg">Loading…</p>
    {:else if error}
      <p class="ds-app-msg">Failed to load recording: {error}</p>
    {:else if !loaded}
      <p class="ds-app-msg">
        No recordings yet. Record a walkthrough from the extension popup and it
        will open here.
      </p>
    {:else if view === "browse"}
      <div class="ds-browse">
        <RecordingLibrary
          {recordings}
          {activeId}
          onOpen={openGuarded}
          onRename={rename}
          onDelete={remove}
        />
        <section class="ds-mode-chooser">
          <h2>Choose your output</h2>
          <div class="ds-mode-options">
            <button class="ds-btn-primary" onclick={() => (view = "video")}
              >▶ Video editor</button
            >
            <button class="ds-btn" onclick={() => (view = "document")}
              >▤ Step document</button
            >
          </div>
          <p class="ds-mode-hint">Switch modes any time — your recording stays put.</p>
        </section>
      </div>
    {:else if view === "video"}
      {#key loaded}
        {#if host}
          <Editor {host} onController={(c) => (controller = c)} />
        {/if}
      {/key}
    {:else}
      {#key loaded}
        <DocumentView
          recording={loaded}
          onController={(c) => (controller = c)}
        />
      {/key}
    {/if}
  </div>

  {#if leaveGuard}
    <div class="ds-tour-backdrop">
      <div class="ds-confirm" role="dialog" aria-modal="true" aria-label="Unsaved changes">
        <h2>Unsaved changes</h2>
        <p>
          You've edited this {view === "document" ? "step document" : "video"}.
          Save your changes before leaving?
        </p>
        <div class="ds-confirm-actions">
          <button class="ds-btn-ghost" onclick={() => (leaveGuard = null)}
            >Cancel</button
          >
          <span class="ds-app-spacer"></span>
          <button class="ds-btn" disabled={saving} onclick={() => void finishLeave()}
            >Discard</button
          >
          <button
            class="ds-btn-primary"
            disabled={saving}
            onclick={() => void saveAndLeave()}
          >
            {saving ? "Saving…" : "Save & leave"}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if tourKind}
    <Tour kind={tourKind} onDone={() => (tourKind = null)} />
  {/if}
</div>
