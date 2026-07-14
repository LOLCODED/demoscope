<script lang="ts">
  import type { ThemeController } from "../theme.svelte.js";

  const { theme }: { theme: ThemeController } = $props();
</script>

<button
  class="ds-btn-icon"
  title={theme.effective === "dark" ? "Switch to light" : "Switch to dark"}
  aria-label="Toggle color theme"
  onclick={() => theme.toggle()}
>
  {theme.effective === "dark" ? "☀" : "◐"}
</button>
