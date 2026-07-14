<script lang="ts">
  import { getStore } from "../context.js";
  import { KEYMAP } from "../keymap.js";

  const store = getStore();
  let open = $state(false);
</script>

<div class="ds-shortcuts">
  <button
    class="ds-btn-icon"
    class:ds-active={open}
    title="Keyboard shortcuts"
    aria-label="Keyboard shortcuts"
    onclick={() => (open = !open)}>⌨</button
  >
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="ds-shortcuts-backdrop" onclick={() => (open = false)}></div>
    <div class="ds-shortcuts-pop" role="dialog" aria-label="Keyboard shortcuts">
      <div class="ds-shortcuts-head">
        <strong>Keyboard shortcuts</strong>
        <button class="ds-btn-ghost" onclick={() => (open = false)}>✕</button>
      </div>
      <ul class="ds-shortcuts-list">
        {#each KEYMAP as binding (binding.id)}
          <li class:ds-disabled={binding.enabled?.(store) === false}>
            <kbd>{binding.label}</kbd>
            <span>{binding.description}</span>
          </li>
        {/each}
        <li><kbd>Esc</kbd><span>Cancel tool / deselect</span></li>
        <li><kbd>Alt</kbd><span>Hold while dragging to disable snapping</span></li>
      </ul>
    </div>
  {/if}
</div>
