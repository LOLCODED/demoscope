# Tour footage harness

Films the guided-tour clips (`extension/assets/tour/`) **with the demoscope
extension itself**: it loads the built extension into headless Chromium,
serves the shared editor on localhost as a filmable page, records each tour
interaction through the extension's real capture pipeline (tabCapture →
offscreen MediaRecorder), and exports every clip through the editor's own
WebM export.

## Regenerating the clips

```sh
cd extension && npm run build            # 1. build the extension
cd scripts/tour-footage && npm install   # 2. harness deps (playwright)
npm run build:film                       # 3. bundle the localhost editor page
npm run record                           # 4. film all 10 clips  (~5 min)
cp clips/*.webm ../../assets/tour/       # 5. ship them
cd ../.. && npm run build                # 6. rebundle assets
cd scripts/tour-footage && npm run verify  # 7. confirm the tour plays them
```

`npm run record <name…>` films a subset (e.g. `video-zoom`). Scenario
choreography lives in `record.mjs` (`SCENARIOS`); the placeholder sample that
populates the editor is generated on first run (cached in `site/sample/`,
delete to regenerate).

## Notes

- Clips export as **WebM (VP9)** — crisp and flicker-free where GIF's 256-color
  quantization wasn't, and the only composited video format Playwright's
  Chromium can encode (no WebCodecs H.264 there; MP4 needs real Chrome).
  `optimize.sh` remains for the legacy GIF path only.
- Each filming session's auto cinematics are replaced (`writeFollowModel`)
  with a single **follow-cursor zoom** (per-scenario `zoom.level`) fed by the
  real pointer trace collected on the filming page — the camera stays zoomed
  and pans with the cursor. Trace↔video clock alignment pairs traced
  pointerups with the recorder's click frames.
- The overlay cursor uses **Highlight cursor** (`cursorHighlight: true`) — a
  soft yellow circle around the always-present arrow, easy to spot at modal
  size.
- The sample recording the editor is seeded with is a **canvas-drawn
  placeholder clip** (`makeSample`) whose manifest has no cursor keyframes, so
  the editor's preview never shows an inner cursor competing with the filming
  session's pointer.
- Playwright must launch with `channel: "chromium"` — the default headless
  shell has no extension support — and `--allowlisted-extension-id` so
  tabCapture needs no user gesture.
- One browser per clip: tab capture only picks its full 800×500 resolution for
  the first recording of a session (later ones degrade to 800×446, clipping
  the Subtitles lane). `exportClip` guards against this.
- Everything is filmed in light mode with tours marked seen and
  `window.prompt` stubbed (no native-dialog freeze in the footage).
