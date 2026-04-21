# demoscope

Create polished product walkthrough videos from JSON step definitions. Define clicks, typing, scrolling, and navigation — demoscope replays them in a browser, captures frames with auto-zoom and animated cursors, and encodes to MP4 or GIF.

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

## Writing step files

A step file is JSON with a `meta` block and a `steps` array:

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

### Per-step options

| Field | Description |
|---|---|
| `zoom` | `{ "level": 2.0, "padding": 40 }` — zoom into the target element |
| `annotation` | Text label overlaid on the frame |
| `wait` | Milliseconds to wait after the action (overrides `defaultWait`) |
| `id` | Optional step identifier |

See `examples/example-search.json` for a complete working example.
