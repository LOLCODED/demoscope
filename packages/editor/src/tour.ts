/**
 * First-launch guided tours, one per editor mode. Steps are data so the same
 * modal renders both. `media` is an optional path to a captured clip (see
 * extension/TOUR.md); when absent the modal shows an animated placeholder, so
 * the tour works today and gains real footage the moment assets are dropped in.
 */
export type TourKind = "video" | "document";

export interface TourStep {
  emoji: string;
  title: string;
  body: string;
  media?: string;
}

export const TOURS: Record<TourKind, TourStep[]> = {
  video: [
    {
      emoji: "🎬",
      title: "Welcome to the video editor",
      body: "It turns your recording into a smooth, focused walkthrough. Here's the 30-second tour — you can skip any time.",
      media: "assets/tour/video-welcome.webm",
    },
    {
      emoji: "🔍",
      title: "Add zooms to focus attention",
      body: "Press Z or right-click the Zooms track to add one at that spot. Drag the ◎ target on the preview to aim it, and set its strength and length in the popover.",
      media: "assets/tour/video-zoom.webm",
    },
    {
      emoji: "💬",
      title: "Caption key moments",
      body: "Press T or right-click the Subtitles track to add a subtitle. Type in the popover above it, and drag its edges on the timeline to time it.",
      media: "assets/tour/video-subtitle.webm",
    },
    {
      emoji: "🧲",
      title: "Retime with soft-lock snapping",
      body: "Drag any segment to move it. It gently snaps to line up with clips, zooms, and subtitles so everything stays in sync — hold Alt to move freely.",
      media: "assets/tour/video-snapping.webm",
    },
    {
      emoji: "💾",
      title: "Autosave and versions",
      body: "Every edit saves automatically. Hit “Save version” to snapshot a named checkpoint you can preview and restore later — nothing is ever lost.",
      media: "assets/tour/video-versions.webm",
    },
    {
      emoji: "⌨️",
      title: "Shortcuts for everything",
      body: "S splits at the playhead, Z adds a zoom, T a subtitle, F sets focus, and more. Open the ⌨ menu in the toolbar for the full list.",
      media: "assets/tour/video-shortcuts.webm",
    },
  ],
  document: [
    {
      emoji: "📄",
      title: "Welcome to the step document",
      body: "It turns your capture into a clean, editable step-by-step guide. Here's the quick tour.",
      media: "assets/tour/document-welcome.webm",
    },
    {
      emoji: "✏️",
      title: "Edit your steps",
      body: "Click any title or description to rewrite it. Reorder steps with ↑/↓, remove ones you don't need, or add a new step.",
      media: "assets/tour/document-edit.webm",
    },
    {
      emoji: "💾",
      title: "Autosave and versions",
      body: "Edits save automatically. Use “Save version” to snapshot a named checkpoint you can preview and restore anytime.",
      media: "assets/tour/document-versions.webm",
    },
    {
      emoji: "📤",
      title: "Export anywhere",
      body: "Copy Markdown, download the images bundle, or print straight to a PDF when you're happy.",
      media: "assets/tour/document-export.webm",
    },
  ],
};

const seenKey = (kind: TourKind) => `demoscope:tour-seen:${kind}`;

export function tourSeen(kind: TourKind): boolean {
  try {
    return localStorage.getItem(seenKey(kind)) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(kind: TourKind): void {
  try {
    localStorage.setItem(seenKey(kind), "1");
  } catch {
    /* private mode / storage disabled — the tour just shows again next time */
  }
}
