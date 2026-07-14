import { mount } from "svelte";
import { EditorApp } from "@demoscope/editor";

// The editor package now owns the entire page: recordings library, mode
// switching (video ⟷ step document), theming, and export.
mount(EditorApp, {
  target: document.getElementById("app")!,
  props: { surface: "extension" },
});
