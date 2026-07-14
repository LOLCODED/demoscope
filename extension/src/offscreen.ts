import { saveVideoBlob } from "@demoscope/browser-kit";
import { RecorderSession } from "./capture/recorder-session.js";

// The offscreen document owns the tab-capture MediaStream + MediaRecorder,
// which a Chrome service worker cannot run (no DOM). It persists across
// navigations in the captured tab, so recording keeps going as the user moves
// between pages.

let session: RecorderSession | null = null;

async function startCapture(
  streamId: string
): Promise<{ ok: boolean; videoStartEpoch?: number; error?: string }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    } as unknown as MediaStreamConstraints);

    session = RecorderSession.start(stream);
    return { ok: true, videoStartEpoch: session.videoStartEpoch };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

async function stopCapture(): Promise<{
  ok: boolean;
  videoStartEpoch: number;
  durationMs: number;
  mime: string;
}> {
  if (!session) {
    return { ok: false, videoStartEpoch: 0, durationMs: 0, mime: "" };
  }
  const result = await session.stop();
  session = null;
  await saveVideoBlob(result.blob);
  return {
    ok: true,
    videoStartEpoch: result.videoStartEpoch,
    durationMs: result.durationMs,
    mime: result.mime,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  switch (msg.type) {
    case "start-capture":
      startCapture(msg.streamId).then(sendResponse);
      return true;
    case "stop-capture":
      stopCapture().then(sendResponse);
      return true;
    default:
      sendResponse({ ok: false, error: "unknown offscreen message" });
  }
});
