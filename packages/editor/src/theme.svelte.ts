export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "demoscope-theme";

/**
 * Reactive theme state. A stored preference (or the OS setting, when unset)
 * resolves to the effective light/dark that the app root applies via
 * `data-ds-theme`. The toggle writes an explicit override that survives reloads.
 */
export class ThemeController {
  preference = $state<ThemePreference>("system");
  private systemDark = $state(false);

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") this.preference = stored;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    this.systemDark = media.matches;
    media.addEventListener(
      "change",
      (event) => (this.systemDark = event.matches)
    );
  }

  effective = $derived<EffectiveTheme>(
    this.preference === "system"
      ? this.systemDark
        ? "dark"
        : "light"
      : this.preference
  );

  /** Flip to the opposite of what's shown and persist it as an override. */
  toggle(): void {
    this.preference = this.effective === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, this.preference);
  }
}
