<script lang="ts">
  import { markTourSeen, TOURS, type TourKind } from "../tour.js";

  const { kind, onDone }: { kind: TourKind; onDone: () => void } = $props();

  const steps = TOURS[kind];
  let index = $state(0);
  const step = $derived(steps[index]);
  const isLast = $derived(index === steps.length - 1);

  function finish(): void {
    markTourSeen(kind);
    onDone();
  }

  function next(): void {
    if (isLast) finish();
    else index += 1;
  }

  function prev(): void {
    if (index > 0) index -= 1;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") finish();
    else if (event.key === "ArrowRight") next();
    else if (event.key === "ArrowLeft") prev();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="ds-tour-backdrop">
  <div class="ds-tour" role="dialog" aria-modal="true" aria-label="Guided tour">
    <div class="ds-tour-media">
      {#if step.media && /\.(webm|mp4)$/.test(step.media)}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={step.media} autoplay loop muted playsinline></video>
      {:else if step.media}
        <img src={step.media} alt={step.title} />
      {:else}
        <div class="ds-tour-placeholder">
          <span class="ds-tour-emoji">{step.emoji}</span>
        </div>
      {/if}
    </div>

    <div class="ds-tour-body">
      <h2>{step.title}</h2>
      <p>{step.body}</p>
    </div>

    <div class="ds-tour-dots" aria-hidden="true">
      {#each steps as _, dot (dot)}
        <span class="ds-tour-dot" class:ds-active={dot === index}></span>
      {/each}
    </div>

    <div class="ds-tour-actions">
      <button class="ds-btn-ghost" onclick={finish}>Skip tour</button>
      <span class="ds-app-spacer"></span>
      {#if index > 0}
        <button class="ds-btn" onclick={prev}>← Back</button>
      {/if}
      <button class="ds-btn-primary" onclick={next}>
        {isLast ? "Get started" : "Next →"}
      </button>
    </div>
  </div>
</div>
