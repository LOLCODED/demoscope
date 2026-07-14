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
  import { ThemeController } from "../theme.svelte.js";
  import Editor from "./Editor.svelte";
  import DocumentView from "./DocumentView.svelte";
  import RecordingLibrary from "./RecordingLibrary.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";

  const { surface = "extension" }: { surface?: Surface } = $props();
  const theme = new ThemeController();

  type View = "browse" | "video" | "document";
  let view = $state<View>("browse");
  let recordings = $state<RecordingListItem[]>([]);
  let loaded = $state<LoadedRecording | null>(null);
  let activeId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const host = $derived(
    loaded
      ? {
          recording: loaded,
          capabilities: detectCapabilities(surface, {
            hasVideo: loaded.mode === "video",
            canRecord: true,
            persistEdits: false,
          }),
        }
      : null
  );

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
      <button class="ds-btn" onclick={() => (view = "browse")}>← Change mode</button>
    {/if}
    <strong class="ds-app-title">{loaded?.title ?? "Demoscope"}</strong>
    <span class="ds-app-spacer"></span>
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
          onOpen={open}
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
          <Editor {host} />
        {/if}
      {/key}
    {:else}
      {#key loaded}
        <DocumentView recording={loaded} />
      {/key}
    {/if}
  </div>
</div>
