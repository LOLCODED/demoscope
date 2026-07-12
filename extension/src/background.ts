import { zipSync, strToU8 } from "fflate";

interface CapturedFrame {
  path: string;
  index: number;
  timestamp: number;
  cursorX: number;
  cursorY: number;
  stepId?: string;
  action?: string;
  annotation?: string;
  isClick?: boolean;
  typedText?: string;
  zoom?: {
    level: number;
    padding: number;
    centerX: number;
    centerY: number;
  };
}

interface RecordingState {
  tabId: number;
  startTime: number;
  frames: CapturedFrame[];
  imageDataUrls: string[];
  frameIndex: number;
  viewport: { width: number; height: number };
  baseUrl: string;
  title: string;
}

let recording: RecordingState | null = null;

// Serialize capture handling so rapid events (click → type → keypress) can't
// race on frameIndex or collide on the captureVisibleTab rate limit.
let captureQueue: Promise<unknown> = Promise.resolve();

// --- Message handling ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "start-recording":
      handleStart(msg.tabId, msg.title);
      sendResponse({ ok: true });
      break;

    case "stop-recording":
      // Wait for any pending captures to finish before closing out.
      captureQueue
        .catch(() => {})
        .then(() => handleStop())
        .then(sendResponse);
      return true;

    case "capture-event": {
      const next = captureQueue
        .catch(() => {})
        .then(() => handleCaptureEvent(msg, sender.tab?.id));
      captureQueue = next.catch(() => {});
      next.then(sendResponse, () => sendResponse({ ok: false, frameCount: 0 }));
      return true;
    }

    case "get-status":
      sendResponse({
        recording: recording !== null,
        stepCount: recording?.frames.length ?? 0,
        tabId: recording?.tabId ?? null,
      });
      break;

    default:
      sendResponse({ ok: false });
  }
});

// --- Recording lifecycle ---

function handleStart(tabId: number, title: string): void {
  recording = {
    tabId,
    startTime: Date.now(),
    frames: [],
    imageDataUrls: [],
    frameIndex: 0,
    viewport: { width: 0, height: 0 },
    baseUrl: "",
    title: title || "Recording",
  };

  chrome.action.setBadgeText({ text: "REC", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#dc2626", tabId });
}

async function handleStop(): Promise<{ ok: boolean; stepCount?: number }> {
  if (!recording) return { ok: false };

  const state = recording;
  recording = null;

  chrome.action.setBadgeText({ text: "", tabId: state.tabId });

  if (state.frames.length === 0) {
    return { ok: true, stepCount: 0 };
  }

  // Build the zip
  const zipData = buildZip(state);
  const filename =
    state.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-capture.zip";

  // Convert to base64 data URL (service workers can't use createObjectURL)
  const base64 = uint8ToBase64(zipData);
  const dataUrl = `data:application/zip;base64,${base64}`;

  await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });

  return { ok: true, stepCount: state.frames.length };
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// --- Event capture ---

async function handleCaptureEvent(
  msg: {
    action: string;
    cursorX: number;
    cursorY: number;
    stepId?: string;
    annotation?: string;
    isClick?: boolean;
    typedText?: string;
    viewport: { width: number; height: number };
    baseUrl: string;
  },
  tabId?: number
): Promise<{ ok: boolean; frameCount: number }> {
  if (!recording || !tabId) return { ok: false, frameCount: 0 };

  // Update viewport/baseUrl from content script
  recording.viewport = msg.viewport;
  if (!recording.baseUrl) recording.baseUrl = msg.baseUrl;

  // Small delay to let the page update after the interaction
  await sleep(150);

  // Capture the visible tab
  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  } catch (err) {
    console.warn("captureVisibleTab failed:", err);
    return { ok: false, frameCount: recording.frames.length };
  }

  // Auto-zoom on interactive events (click, type, keypress)
  const shouldZoom = ["click", "type", "keypress"].includes(msg.action);
  const zoom = shouldZoom
    ? {
        level: 1.8,
        padding: 60,
        centerX: msg.cursorX,
        centerY: msg.cursorY,
      }
    : undefined;

  const frame: CapturedFrame = {
    path: `frames/frame-${String(recording.frameIndex).padStart(4, "0")}.png`,
    index: recording.frameIndex,
    timestamp: Date.now() - recording.startTime,
    cursorX: msg.cursorX,
    cursorY: msg.cursorY,
    stepId: msg.stepId,
    action: msg.action,
    annotation: msg.annotation,
    isClick: msg.isClick,
    typedText: msg.typedText,
    zoom,
  };

  recording.frames.push(frame);
  recording.imageDataUrls.push(dataUrl);
  recording.frameIndex++;

  // Update badge
  chrome.action.setBadgeText({
    text: String(recording.frames.length),
    tabId: recording.tabId,
  });
  chrome.action.setBadgeBackgroundColor({
    color: "#2563eb",
    tabId: recording.tabId,
  });

  return { ok: true, frameCount: recording.frames.length };
}

// --- Zip building ---

function buildZip(state: RecordingState): Uint8Array {
  const manifest = {
    meta: {
      title: state.title,
      baseUrl: state.baseUrl,
      viewport: state.viewport,
      defaultWait: 500,
    },
    fps: 30,
    frames: state.frames,
  };

  const files: Record<string, Uint8Array> = {
    "capture-manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  };

  // Convert data URLs to binary
  for (let i = 0; i < state.imageDataUrls.length; i++) {
    const dataUrl = state.imageDataUrls[i];
    const base64 = dataUrl.split(",")[1];
    const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const filename = `frames/frame-${String(i).padStart(4, "0")}.png`;
    files[filename] = binary;
  }

  return zipSync(files, { level: 1 }); // fast compression
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {};
