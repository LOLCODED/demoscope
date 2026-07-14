<script lang="ts" generics="T">
  import {
    deleteEditVersion,
    loadEditDoc,
    renameEditVersion,
    saveEditVersion,
    type EditKind,
    type EditVersion,
  } from "@demoscope/browser-kit";

  interface Props {
    recordingId: string;
    kind: EditKind;
    /** The auto-derived default, shown as the "Original" restore point. */
    baseline: T;
    /** Snapshot the live working copy (called when saving / before restoring). */
    getCurrent: () => T;
    onPreview: (model: T) => void;
    onExitPreview: () => void;
    onRestore: (model: T) => void;
    /** Persist the working copy after a save/version action (explicit-save). */
    onSaved?: () => void | Promise<void>;
  }

  let {
    recordingId,
    kind,
    baseline,
    getCurrent,
    onPreview,
    onExitPreview,
    onRestore,
    onSaved,
  }: Props = $props();

  const AUTO_ID = "__auto__";

  let versions = $state<EditVersion<T>[]>([]);
  let previewingId = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    const doc = await loadEditDoc<T>(recordingId, kind);
    versions = doc?.versions ?? [];
  }

  async function saveVersion(): Promise<void> {
    const name = window
      .prompt("Name this version", `Version ${versions.length + 1}`)
      ?.trim();
    if (!name) return;
    busy = true;
    await saveEditVersion(recordingId, kind, name, getCurrent());
    await onSaved?.();
    await refresh();
    busy = false;
  }

  function startPreview(id: string, model: T): void {
    previewingId = id;
    onPreview(model);
  }

  function stopPreview(): void {
    previewingId = null;
    onExitPreview();
  }

  /**
   * Adopt a version as the working copy. The current working copy is snapshotted
   * as a backup first, so a restore can always be undone. Any active preview is
   * exited beforehand so the backup captures the real working copy, not the
   * previewed model.
   */
  async function restore(model: T): Promise<void> {
    busy = true;
    if (previewingId !== null) onExitPreview();
    previewingId = null;
    await saveEditVersion(recordingId, kind, autoBackupName(), getCurrent());
    onRestore(model);
    await refresh();
    busy = false;
  }

  function restorePreviewed(): void {
    const model =
      previewingId === AUTO_ID
        ? baseline
        : versions.find((version) => version.id === previewingId)?.model;
    if (model !== undefined) void restore(model);
  }

  async function remove(id: string): Promise<void> {
    if (!window.confirm("Delete this saved version?")) return;
    if (previewingId === id) stopPreview();
    await deleteEditVersion(recordingId, kind, id);
    await refresh();
  }

  async function rename(version: EditVersion<T>): Promise<void> {
    const name = window.prompt("Rename version", version.name)?.trim();
    if (!name) return;
    await renameEditVersion(recordingId, kind, version.id, name);
    await refresh();
  }

  const autoBackupName = () =>
    `Backup before restore — ${new Date().toLocaleString()}`;

  const previewingName = $derived(
    previewingId === AUTO_ID
      ? "Original (auto)"
      : (versions.find((version) => version.id === previewingId)?.name ?? null)
  );
</script>

<section class="ds-versions">
  <div class="ds-versions-head">
    <h3>Versions</h3>
    <button
      class="ds-btn"
      onclick={() => void saveVersion()}
      disabled={busy || previewingId !== null}>Save version</button
    >
  </div>

  {#if previewingId !== null}
    <div class="ds-versions-preview">
      <span>Previewing <strong>{previewingName}</strong> — edits are paused.</span>
      <div class="ds-versions-preview-actions">
        <button class="ds-btn-primary" onclick={restorePreviewed} disabled={busy}
          >Restore this version</button
        >
        <button class="ds-btn" onclick={stopPreview}>Exit preview</button>
      </div>
    </div>
  {/if}

  <ul class="ds-versions-list">
    {#each versions as version (version.id)}
      <li class="ds-version" class:ds-active={previewingId === version.id}>
        <div class="ds-version-meta">
          <button
            class="ds-version-name"
            title="Rename"
            onclick={() => void rename(version)}>{version.name}</button
          >
          <time>{new Date(version.createdAt).toLocaleString()}</time>
        </div>
        <div class="ds-version-actions">
          <button class="ds-btn" onclick={() => startPreview(version.id, version.model)}
            >Preview</button
          >
          <button class="ds-btn" onclick={() => void restore(version.model)} disabled={busy}
            >Restore</button
          >
          <button
            class="ds-btn-ghost"
            aria-label="Delete version"
            onclick={() => void remove(version.id)}>✕</button
          >
        </div>
      </li>
    {/each}
    <li class="ds-version" class:ds-active={previewingId === AUTO_ID}>
      <div class="ds-version-meta">
        <span class="ds-version-name">Original (auto)</span>
        <time>Auto-generated default</time>
      </div>
      <div class="ds-version-actions">
        <button class="ds-btn" onclick={() => startPreview(AUTO_ID, baseline)}>Preview</button>
        <button class="ds-btn" onclick={() => void restore(baseline)} disabled={busy}
          >Restore</button
        >
      </div>
    </li>
  </ul>
</section>
