import {
  type CapturedFrame,
  type CaptureManifest,
  saveRecordingRecord,
} from "@demoscope/browser-kit";

type CaptureMode = "screenshot" | "video";

interface RecordingState {
  tabId: number;
  startTime: number;
  frames: CapturedFrame[];
  imageDataUrls: string[];
  frameIndex: number;
  viewport: { width: number; height: number };
  baseUrl: string;
  title: string;
  mode: CaptureMode;
  videoStartEpoch: number;
}

let recording: RecordingState | null = null;

// Serialize capture handling so rapid events (click → type → keypress) can't
// race on frameIndex or collide on the captureVisibleTab rate limit.
let captureQueue: Promise<unknown> = Promise.resolve();

// --- Message handling ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "offscreen") return; // handled by the offscreen document

  switch (msg.type) {
    case "start-recording":
      handleStart(msg.tabId, msg.title).then((mode) =>
        sendResponse({ ok: true, mode })
      );
      return true;

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

async function handleStart(tabId: number, title: string): Promise<CaptureMode> {
  recording = {
    tabId,
    startTime: Date.now(),
    frames: [],
    imageDataUrls: [],
    frameIndex: 0,
    viewport: { width: 0, height: 0 },
    baseUrl: "",
    title: title || "Recording",
    mode: "screenshot",
    videoStartEpoch: 0,
  };

  chrome.action.setBadgeText({ text: "REC", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#dc2626", tabId });

  // Prefer continuous-video capture (smooth) via silent tab capture into an
  // offscreen MediaRecorder; fall back to per-event screenshots if it fails.
  try {
    const streamId = await getMediaStreamId(tabId);
    await ensureOffscreen();
    const resp = await sendToOffscreen({ type: "start-capture", streamId });
    if (resp?.ok) {
      recording.mode = "video";
      recording.videoStartEpoch = resp.videoStartEpoch;
    } else {
      console.warn("offscreen capture failed, using screenshots:", resp?.error);
      await closeOffscreen();
    }
  } catch (err) {
    console.warn("tabCapture unavailable, using screenshots:", err);
  }

  return recording.mode;
}

interface StoppedVideo {
  mime: string;
  durationMs: number;
  videoStartEpoch: number;
}

async function handleStop(): Promise<{ ok: boolean; stepCount?: number }> {
  if (!recording) return { ok: false };

  const state = recording;
  recording = null;
  chrome.action.setBadgeText({ text: "", tabId: state.tabId });

  // Stop the offscreen recorder (which saved its own blob) and grab the result.
  let video: StoppedVideo | null = null;
  if (state.mode === "video") {
    const result = await sendToOffscreen({ type: "stop-capture" });
    await closeOffscreen();
    if (result?.ok) video = result;
  }

  if (state.frames.length === 0) return { ok: true, stepCount: 0 };

  const manifest = buildManifest(state);
  if (video) {
    manifest.video = { mime: video.mime, durationMs: video.durationMs };
    applyVideoTimings(manifest, state.startTime, video.videoStartEpoch);
    await saveRecordingRecord({ title: state.title, mode: "video", manifest });
  } else {
    await saveRecordingRecord({
      title: state.title,
      mode: "screenshot",
      manifest,
      images: state.imageDataUrls,
    });
  }

  // The render page owns preview + export; open it to finish the flow.
  await chrome.tabs.create({ url: chrome.runtime.getURL("render.html") });

  return { ok: true, stepCount: state.frames.length };
}

function buildManifest(state: RecordingState): CaptureManifest {
  return {
    meta: {
      title: state.title,
      baseUrl: state.baseUrl,
      viewport: state.viewport,
      defaultWait: 500,
    },
    fps: 30,
    frames: state.frames,
  };
}

/** Anchor each event to the video clock: videoTimeMs = eventEpoch - videoStart. */
function applyVideoTimings(
  manifest: CaptureManifest,
  recordingStart: number,
  videoStartEpoch: number
): void {
  const durationMs = manifest.video?.durationMs ?? Infinity;
  for (const frame of manifest.frames) {
    const eventEpoch = recordingStart + frame.timestamp;
    frame.videoTimeMs = Math.max(
      0,
      Math.min(eventEpoch - videoStartEpoch, durationMs)
    );
  }
}

// --- Offscreen document (video capture host) ---

function getMediaStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err || !streamId) reject(err ?? new Error("no streamId"));
      else resolve(streamId);
    });
  });
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Record the active tab as video for the demo capture.",
  });
}

async function closeOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument())
    await chrome.offscreen.closeDocument();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendToOffscreen(msg: Record<string, any>): Promise<any> {
  return chrome.runtime.sendMessage({ target: "offscreen", ...msg });
}

// --- Event capture ---

async function handleCaptureEvent(
  msg: {
    action: string;
    cursorX?: number;
    cursorY?: number;
    stepId?: string;
    annotation?: string;
    isClick?: boolean;
    typedText?: string;
    immediate?: boolean;
    viewport: { width: number; height: number };
    baseUrl: string;
  },
  tabId?: number
): Promise<{ ok: boolean; frameCount: number }> {
  if (!recording || !tabId) return { ok: false, frameCount: 0 };

  recording.viewport = msg.viewport;
  if (!recording.baseUrl) recording.baseUrl = msg.baseUrl;

  // Screenshot mode grabs a frame per interaction; video mode records only the
  // interaction metadata (cursor/zoom/annotation) and reads pixels from the
  // continuously-recorded video at render time.
  if (recording.mode === "screenshot") {
    // Let the page settle after an interaction before capturing. The initial
    // frame is flagged `immediate` so the pristine starting state is captured
    // at once, before the user's first action can navigate the page away.
    if (!msg.immediate) await sleep(150);
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
      recording.imageDataUrls.push(dataUrl);
    } catch (err) {
      console.warn("captureVisibleTab failed:", err);
      return { ok: false, frameCount: recording.frames.length };
    }
  }

  const zoom =
    ["click", "type", "keypress"].includes(msg.action) &&
    msg.cursorX !== undefined &&
    msg.cursorY !== undefined
      ? { level: 1.8, padding: 60, centerX: msg.cursorX, centerY: msg.cursorY }
      : undefined;
  recording.frames.push({
    path:
      recording.mode === "screenshot"
        ? `frames/frame-${String(recording.frameIndex).padStart(4, "0")}.png`
        : "",
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
  });
  recording.frameIndex++;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {};
