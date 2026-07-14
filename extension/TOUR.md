# Guided-tour footage

The first-launch tour (video + document editors) ships with a real clip per
step under `assets/tour/`, filmed by the extension recording its own editor.
Steps fall back to an animated emoji placeholder whenever their `media` field
is unset or the asset is missing, so partial footage always works. Clips are
WebM video (crisp, no GIF banding/flicker); plain GIFs still work if that's
what you have.

**To regenerate the clips after a UI change, run the automated harness in
`scripts/tour-footage/` (see its README).** The sections below describe the
manual process it automates.

## Where files go

Put clips under `extension/assets/tour/`. The build copies `assets/` to
`dist/chrome/assets/`, and the render page loads them by relative path, e.g.
`assets/tour/video-zoom.webm`.

Suggested names (one per tour step):

```
extension/assets/tour/
  video-welcome.webm
  video-zoom.webm
  video-subtitle.webm
  video-snapping.webm
  video-versions.webm
  video-shortcuts.webm
  document-welcome.webm
  document-edit.webm
  document-versions.webm
  document-export.webm
```

## Wiring a clip to its step

Edit `packages/editor/src/tour.ts` and add a `media` field to the step:

```ts
{
  emoji: "🔍",
  title: "Add zooms to focus attention",
  body: "Press Z or right-click the Zooms track…",
  media: "assets/tour/video-zoom.webm",
},
```

When `media` is set the modal shows the clip (`<video>` for .webm/.mp4, an
image otherwise); when it's absent it falls back to the animated placeholder.
So you can add footage one step at a time.

## Capturing the clips with the extension itself

The extension is the recorder, so it can film its own UI:

1. `cd extension && npm run build`, then load `dist/chrome` as an unpacked
   extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).
2. Open the render page and set up the exact interaction you want to show
   (e.g. dragging the ◎ focus target, or the timeline soft-lock snapping).
3. Use the extension popup to record that interaction, then export **WebM**
   (works everywhere; MP4 is Chrome-only). Keep clips short (3–8s); a
   follow-cursor zoom (see the zoom popover) keeps them readable at modal
   size.
4. Save the exported clip into `extension/assets/tour/` with the name above
   and set the matching `media` field in `tour.ts`.
5. Rebuild. The tour now plays real footage.

Keep clips small (aim for < 1.5 MB each) — they're bundled into the extension.

## Resetting the "seen" flag while iterating

The tour auto-opens once per mode, tracked in `localStorage`
(`demoscope:tour-seen:video` / `:document`). To see it again, clear those keys
in DevTools, or click the **?** button in the editor's top bar to replay it.
