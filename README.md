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

| Flag | Description | Default |
|---|---|---|
| `-o, --output` | Output file/directory | `./output.mp4` |
| `-f, --format` | `mp4` or `gif` | `mp4` |
| `--fps` | Frames per second | `30` |
| `--width` | Output width in pixels | viewport width |
| `--headed` | Show browser window while capturing | off |
| `--transition` | Zoom transition duration (ms) | `500` |
| `--hold` | Hold time per step (ms) — raise to slow the video down | `500` |
| `--annotation-hold` | Hold time when a step has an annotation (ms) | `1500` |
| `--intro-hold` | Hold time on the very first frame (ms) | `1500` |
| `--cursor-size` | Cursor size in pixels (scales the SVG and its hotspot) | `24` |
| `--no-annotations` | Hide annotation overlays | annotations shown |

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
    { "action": "type", "selector": "#email", "text": "user@example.com", "typeDelay": 80 },
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

| Action | Required fields | Description |
|---|---|---|
| `navigate` | `url` | Go to a URL (relative to `baseUrl` or absolute) |
| `click` | `selector` | Click an element |
| `type` | `selector`, `text` | Type text character by character |
| `scroll` | `deltaY` | Scroll the page or a specific element (`selector`) |
| `wait` | `duration` | Pause for N milliseconds |
| `hover` | `selector` | Hover over an element |
| `select` | `selector`, `value` | Select a dropdown option |
| `keypress` | `key` | Press a key (Enter, Escape, Tab, etc.) |

### Per-step options

| Field | Description |
|---|---|
| `zoom` | `{ "level": 2.0, "padding": 40 }` — zoom into the target element |
| `annotation` | Text label overlaid on the frame |
| `wait` | Milliseconds to wait after the action (overrides `defaultWait`) |
| `id` | Optional step identifier |

See `examples/example-search.json` (or `examples/example-search.yaml`) for a complete working example.

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
