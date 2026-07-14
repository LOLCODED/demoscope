import {
  startRecording,
  stopRecording,
  isRecording,
  getSteps,
  type InteractionEvent,
} from "./lib/recorder.js";
import { exportStepFile } from "./lib/export.js";

declare global {
  interface Window {
    __demoscopeRecorderLoaded?: boolean;
  }
}

let captureEnabled = false;

// The script can be injected twice on one page: programmatically when
// recording starts on a tab that predates the extension load, and again by the
// manifest when the page reaches document_idle. Only the first copy may
// register, or every interaction would be captured twice.
if (!window.__demoscopeRecorderLoaded) {
  window.__demoscopeRecorderLoaded = true;
  init();
}

function init(): void {
  // On load, check if background is recording this tab and auto-resume
  chrome.runtime
    .sendMessage({ type: "get-status" })
    .then((resp) => {
      if (resp?.recording) {
        captureEnabled = true;
        startRecording(onInteraction);
      }
    })
    .catch(() => {});

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener(onMessage);
}

function onMessage(
  msg: { type: string; title?: string },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean {
  switch (msg.type) {
    case "start-recording":
      captureEnabled = true;
      startRecording(onInteraction);
      sendResponse({ ok: true });
      break;

    case "stop-recording": {
      captureEnabled = false;
      const recorded = stopRecording();
      const stepFile = exportStepFile(recorded, msg.title || "Recording");
      sendResponse({ ok: true, stepFile, stepCount: recorded.length });
      break;
    }

    case "get-status":
      sendResponse({
        recording: isRecording(),
        stepCount: getSteps().length,
      });
      break;

    default:
      sendResponse({ ok: false, error: "unknown message type" });
  }

  return true;
}

/**
 * Called by the recorder after each interaction.
 * Sends event data to background for screenshot capture.
 */
function onInteraction(event: InteractionEvent): void {
  if (!captureEnabled) return;

  chrome.runtime
    .sendMessage({
      type: "capture-event",
      ...event,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      baseUrl: window.location.origin,
    })
    .catch(() => {});
}
