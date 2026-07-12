# demoscope

Create polished product walkthrough videos from step definitions (JSON or YAML). Define clicks, typing, scrolling, and navigation — demoscope replays them in a browser, captures frames with auto-zoom, smooth cursor motion, and animated click effects, then encodes to MP4 or GIF.

## Prerequisites

- Node.js 18+
- ffmpeg installed and on PATH

## Setup

```bash
npm install
npx playwright install chromium
npx tsc --build packages/cli/tsconfig.json
```

## Usage

### One command (recommended)

```bash
node packages/cli/dist/index.js demo steps.json -o walkthrough.mp4
```

### Two-step (capture then render)

```bash
# Capture frames from a step file
node packages/cli/dist/index.js run steps.json -o ./capture

# Render to MP4
node packages/cli/dist/index.js render ./capture -o demo.mp4

# Or GIF
node packages/cli/dist/index.js render ./capture -o demo.gif -f gif
```

### Options

| Flag                | Description                                                         | Default                |
| ------------------- | ------------------------------------------------------------------- | ---------------------- |
| `-o, --output`      | Output file/directory                                               | `./output.mp4`         |
| `-f, --format`      | `mp4` or `gif`                                                      | `mp4`                  |
| `--fps`             | Frames per second                                                   | `30`                   |
| `--width`           | Output width in pixels                                              | viewport width         |
| `--headed`          | Show browser window while capturing                                 | off                    |
| `--transition`      | Zoom transition duration (ms)                                       | `500`                  |
| `--hold`            | Hold time per step (ms) — raise to slow the video down              | `500`                  |
| `--annotation-hold` | Hold time when a step has an annotation (ms)                        | `1500`                 |
| `--intro-hold`      | Hold time on the very first frame (ms)                              | `1500`                 |
| `--cursor-size`     | Cursor size in pixels (scales the SVG and its hotspot)              | `24`                   |
| `--click-cursor`    | Cursor shape on click frames: `arrow` or `pointer`                  | `arrow`                |
| `--no-annotations`  | Hide annotation overlays                                            | annotations shown      |
| `--timeout`         | _(`run`/`demo`)_ Timeout for waiting on elements (ms)               | `10000`                |
| `--fail-fast`       | _(`run`/`demo`)_ Abort on first step failure instead of skipping it | off (skip & continue)  |
| `--capture-dir`     | _(`demo`)_ Directory for the intermediate frame capture             | `./.demoscope-capture` |

Tip: iterate on pacing without re-recording by re-running `render` on the same `.zip` with different `--hold` / `--annotation-hold` values.

## Writing step files

Step files can be JSON or YAML. Both use the same structure: a `meta` block and a `steps` array.

**JSON:**

```json
{
  "meta": {
    "baseUrl": "http://localhost:3000",
    "viewport": { "width": 1280, "height": 720 },
    "defaultWait": 500
  },
  "steps": [
    { "action": "navigate", "url": "/dashboard" },
    { "action": "click", "selector": "#login-btn", "zoom": { "level": 2.0 } },
    {
      "action": "type",
      "selector": "#email",
      "text": "user@example.com",
      "typeDelay": 80
    },
    { "action": "wait", "duration": 1000, "annotation": "Done!" }
  ]
}
```

**YAML:**

```yaml
meta:
  baseUrl: http://localhost:3000
  viewport:
    width: 1280
    height: 720
  defaultWait: 500

steps:
  - action: navigate
    url: /dashboard
  - action: click
    selector: "#login-btn"
    zoom:
      level: 2.0
  - action: type
    selector: "#email"
    text: user@example.com
    typeDelay: 80
  - action: wait
    duration: 1000
    annotation: Done!
```

### Actions

| Action     | Required fields     | Description                                        |
| ---------- | ------------------- | -------------------------------------------------- |
| `navigate` | `url`               | Go to a URL (relative to `baseUrl` or absolute)    |
| `click`    | `selector`          | Click an element                                   |
| `type`     | `selector`, `text`  | Type text character by character                   |
| `scroll`   | `deltaY`            | Scroll the page or a specific element (`selector`) |
| `wait`     | `duration`          | Pause for N milliseconds                           |
| `hover`    | `selector`          | Hover over an element                              |
| `select`   | `selector`, `value` | Select a dropdown option                           |
| `keypress` | `key`               | Press a key (Enter, Escape, Tab, etc.)             |

### Per-step options

| Field        | Description                                                      |
| ------------ | ---------------------------------------------------------------- |
| `zoom`       | `{ "level": 2.0, "padding": 40 }` — zoom into the target element |
| `annotation` | Text label overlaid on the frame                                 |
| `wait`       | Milliseconds to wait after the action (overrides `defaultWait`)  |
| `id`         | Optional step identifier                                         |

See `examples/example-search.json` (or `examples/example-search.yaml`) for a complete working example.

## Examples

All commands below assume you've completed [Setup](#setup). The `examples/` folder ships an identical step file in both formats (`example-search.yaml` and `example-search.json`), so every example works out of the box.

### 1. Turn the bundled example into a video

The fastest way to see demoscope work — one command, no config:

```bash
node packages/cli/dist/index.js demo examples/example-search.yaml -o wikipedia.mp4
```

Same input, GIF output:

```bash
node packages/cli/dist/index.js demo examples/example-search.json -o wikipedia.gif -f gif
```

Watch it drive a real browser window as it captures:

```bash
node packages/cli/dist/index.js demo examples/example-search.yaml -o wikipedia.mp4 --headed
```

### 2. Capture once, render many times

`run` captures browser frames; `render` turns them into a video. Splitting them lets you tune pacing without re-recording the browser session:

```bash
# Capture the browser session once
node packages/cli/dist/index.js run examples/example-search.yaml -o ./capture

# Render a few variations from the same frames
node packages/cli/dist/index.js render ./capture -o fast.mp4  --hold 250
node packages/cli/dist/index.js render ./capture -o slow.mp4  --hold 1200 --annotation-hold 2500
node packages/cli/dist/index.js render ./capture -o social.gif -f gif --width 640
```

### 3. Use every action type

Beyond `navigate`/`click`/`type`, the runner also supports `hover`, `select`, `keypress`, and `scroll` (which can target a specific element). This step file exercises all of them:

```yaml
meta:
  title: "Full action tour"
  baseUrl: http://localhost:3000
  viewport:
    width: 1280
    height: 720
  defaultWait: 600

steps:
  - action: navigate
    url: /dashboard
    annotation: Open the dashboard

  - action: hover
    selector: "#profile-menu"
    annotation: Reveal the menu

  - action: select
    selector: "#region"
    value: us-west
    zoom:
      level: 1.8

  - action: scroll
    selector: "#results" # omit selector to scroll the whole page
    deltaY: 600

  - action: type
    selector: "#search"
    text: quarterly report
    typeDelay: 90

  - action: keypress
    key: Enter # keypress accepts an optional `selector` to focus first
    annotation: Submit the search
```

Render it the same way:

```bash
node packages/cli/dist/index.js demo tour.yaml -o tour.mp4
```

### 4. Handling flaky or slow pages

By default a step whose selector isn't found is logged and skipped so the video still renders. Flip that behavior, or give slow pages more time to settle, with flags on `run`/`demo`:

```bash
# Abort on the first failed step instead of skipping it
node packages/cli/dist/index.js demo tour.yaml -o tour.mp4 --fail-fast

# Wait up to 30s for elements to appear (default 10s)
node packages/cli/dist/index.js run tour.yaml -o ./capture --timeout 30000
```

### 5. From a Chrome extension recording

If you'd rather record by hand — especially on pages behind a login — use the [Chrome extension](#chrome-extension-recorder) to produce a `.zip`, then render it directly (no step file needed):

```bash
node packages/cli/dist/index.js render my-recording-capture.zip -o walkthrough.mp4
```

## Chrome Extension (Recorder)

Record interactions directly in your browser with screenshots. Works with auth'd pages — the extension captures what you see, no Playwright session needed.

### Build the extension

```bash
cd extension
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `extension/dist` directory

### Record a walkthrough

1. Navigate to the page you want to demo (including pages behind login)
2. Click the Demoscope extension icon
3. Optionally enter a title, then click **Start Recording**
4. Interact with the page — clicks, typing, scrolling, key presses, and navigation are captured with screenshots
5. Click the extension icon again and click **Stop & Export**
6. Save the downloaded `.zip` file

### Turn it into a video

The zip contains screenshots + a capture manifest. Pass it directly to `demoscope render`:

```bash
# Render from zip (auto-extracts)
node packages/cli/dist/index.js render my-recording-capture.zip -o walkthrough.mp4

# Or extract first and render the directory
unzip my-recording-capture.zip -d ./capture
node packages/cli/dist/index.js render ./capture -o walkthrough.mp4

# GIF output
node packages/cli/dist/index.js render my-recording-capture.zip -o walkthrough.gif -f gif
```

## Development

Run from the repo root:

```bash
npm test          # run the unit tests (vitest)
npm run test:watch # re-run tests on change
npm run lint      # eslint across all packages + extension
npm run format    # format the repo with prettier
npm run build     # type-check and compile all packages
```

Unit tests live next to the code they cover (`packages/*/src/*.test.ts`) and
focus on the pure logic — zoom/crop math, cursor interpolation, the render
timeline, and step-file parsing/validation.

Formatting and linting are enforced on commit: a Husky `pre-commit` hook runs
`lint-staged`, which applies ESLint and Prettier to staged files. Hooks are
installed automatically via the `prepare` script when you run `npm install`.
