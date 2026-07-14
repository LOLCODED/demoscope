<script lang="ts">
  import type { RecordingListItem } from "@demoscope/browser-kit";

  const {
    recordings,
    activeId,
    onOpen,
    onRename,
    onDelete,
  }: {
    recordings: RecordingListItem[];
    activeId: string | null;
    onOpen: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
  } = $props();

  const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
</script>

{#if recordings.length > 0}
  <section class="ds-library">
    <h2>Recordings</h2>
    <div class="ds-library-list">
      {#each recordings as recording (recording.id)}
        <article
          class="ds-library-item"
          class:ds-active={recording.id === activeId}
        >
          <div class="ds-library-details">
            <input
              class="ds-library-title"
              value={recording.title}
              onchange={(event) =>
                onRename(recording.id, event.currentTarget.value)}
            />
            <button
              class="ds-library-open"
              onclick={() => onOpen(recording.id)}
            >
              {recording.mode} · {recording.frameCount} steps · {when(
                recording.createdAt
              )}
            </button>
          </div>
          <button
            class="ds-btn-ghost"
            onclick={() => onDelete(recording.id)}>Delete</button
          >
        </article>
      {/each}
    </div>
  </section>
{/if}
