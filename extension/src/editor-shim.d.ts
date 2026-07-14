// tsc can't parse Svelte source (runes, .svelte files), so it type-checks the
// extension against this faithful stub of @demoscope/editor's public surface.
// esbuild-svelte bundles the real source via its own alias (see build.mjs).
declare module "@demoscope/editor" {
  import type { Component } from "svelte";
  import type {
    Capabilities,
    LoadedRecording,
    Surface,
  } from "@demoscope/browser-kit";

  export interface EditorHost {
    recording: LoadedRecording;
    capabilities: Capabilities;
  }

  export const Editor: Component<{ host: EditorHost }>;
  export const EditorApp: Component<{ surface?: Surface }>;
}
