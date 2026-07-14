import {
  startRecording,
  stopRecording,
  isRecording,
  getSteps,
  type InteractionEvent,
} from "./lib/recorder.js";
import { exportStepFile } from "./lib/export.js";

let captureEnabled = false;

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
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
});

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
