import type { EditorStore } from "./store.svelte.js";

/**
 * The editor's keyboard shortcuts as data, so a single source drives dispatch,
 * button tooltips, and the shortcuts legend. `combo` is canonical
 * (`"mod"` = ⌘/Ctrl); `label` is what we show the user.
 */
export interface KeyBinding {
  id: string;
  combo: string;
  label: string;
  description: string;
  run: (store: EditorStore) => void;
  /** Whether the action currently applies (drives legend dimming). */
  enabled?: (store: EditorStore) => boolean;
}

export const KEYMAP: KeyBinding[] = [
  {
    id: "playPause",
    combo: "space",
    label: "Space",
    description: "Play / pause",
    run: (s) => s.togglePlayback(),
  },
  {
    id: "split",
    combo: "s",
    label: "S",
    description: "Split at playhead",
    run: (s) => s.split(),
  },
  {
    id: "addZoom",
    combo: "z",
    label: "Z",
    description: "Add zoom at playhead",
    run: (s) => s.addZoom(),
  },
  {
    id: "addSubtitle",
    combo: "t",
    label: "T",
    description: "Add subtitle at playhead",
    run: (s) => s.addSubtitle(),
  },
  {
    id: "pickFocus",
    combo: "f",
    label: "F",
    description: "Set zoom focus point",
    run: (s) => s.startPickFocus(),
    enabled: (s) => s.primaryKind === "zoom",
  },
  {
    id: "crop",
    combo: "c",
    label: "C",
    description: "Toggle crop",
    run: (s) => (s.tool = s.tool === "crop" ? "none" : "crop"),
  },
  {
    id: "markIn",
    combo: "i",
    label: "I",
    description: "Mark in",
    run: (s) => s.markIn(),
  },
  {
    id: "markOut",
    combo: "o",
    label: "O",
    description: "Mark out",
    run: (s) => s.markOut(),
  },
  {
    id: "removeRange",
    combo: "r",
    label: "R",
    description: "Remove marked range",
    run: (s) => s.removeMarkedRange(),
    enabled: (s) => s.markInMs !== null && s.markOutMs !== null,
  },
  {
    id: "delete",
    combo: "delete",
    label: "Del",
    description: "Delete selected",
    run: (s) => s.deleteSelected(),
    enabled: (s) => s.selectedIds.length > 0,
  },
  {
    id: "undo",
    combo: "mod+z",
    label: "⌘Z",
    description: "Undo",
    run: (s) => s.undo(),
    enabled: (s) => s.canUndo,
  },
  {
    id: "redo",
    combo: "mod+shift+z",
    label: "⌘⇧Z",
    description: "Redo",
    run: (s) => s.redo(),
    enabled: (s) => s.canRedo,
  },
];

const normalizeKey = (key: string): string => {
  const lower = key.toLowerCase();
  if (lower === " " || lower === "spacebar") return "space";
  if (lower === "delete" || lower === "backspace") return "delete";
  return lower;
};

/** Resolve a keyboard event to its binding, or undefined if none matches. */
export function matchBinding(event: KeyboardEvent): KeyBinding | undefined {
  const mod = event.ctrlKey || event.metaKey;
  const key = normalizeKey(event.key);
  return KEYMAP.find((binding) => {
    const parts = binding.combo.split("+");
    const base = parts[parts.length - 1];
    return (
      base === key &&
      parts.includes("mod") === mod &&
      parts.includes("shift") === event.shiftKey
    );
  });
}

/** Look up a binding's display label by id (for button tooltips). */
export const shortcutLabel = (id: string): string =>
  KEYMAP.find((binding) => binding.id === id)?.label ?? "";
