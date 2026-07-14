import { getContext, setContext } from "svelte";
import type { EditorStore } from "./store.svelte.js";

const KEY = Symbol("demoscope-editor-store");

export const setStore = (store: EditorStore): EditorStore =>
  setContext(KEY, store);

export const getStore = (): EditorStore => getContext(KEY) as EditorStore;
