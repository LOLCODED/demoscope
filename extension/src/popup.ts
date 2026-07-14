const idleView = document.getElementById("idle-view")!;
const recordingView = document.getElementById("recording-view")!;
const startBtn = document.getElementById("start-btn")!;
const stopBtn = document.getElementById("stop-btn")!;
const titleInput = document.getElementById("title-input") as HTMLInputElement;
const stepCountEl = document.getElementById("step-count")!;
const exportNote = document.getElementById("export-note")!;
const savedRecordings = document.getElementById("saved-recordings")!;
const savedList = document.getElementById("saved-list")!;

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showRecording(): void {
  idleView.classList.add("hidden");
  recordingView.classList.remove("hidden");
  exportNote.classList.add("hidden");
}

function showIdle(): void {
  recordingView.classList.add("hidden");
  idleView.classList.remove("hidden");
}

// Check current state from background
async function checkStatus(): Promise<void> {
  try {
    const resp = (await chrome.runtime.sendMessage({ type: "get-status" })) as {
      recording: boolean;
      stepCount: number;
    };
    if (resp?.recording) {
      showRecording();
      stepCountEl.textContent = String(resp.stepCount);
    }
  } catch {
    // background not ready
  }
}

async function renderSavedRecordings(): Promise<void> {
  const recordings = await listRecordings();
  savedRecordings.classList.toggle("hidden", recordings.length === 0);
  savedList.replaceChildren(...recordings.slice(0, 5).map(savedRecordingItem));
}

function savedRecordingItem(record: RecordingListItem): HTMLElement {
  const item = document.createElement("article");
  item.className = "saved-item";
  const open = document.createElement("button");
  open.className = "saved-open";
  open.innerHTML = `<strong>${escapeHtml(record.title)}</strong><span>${record.mode} · ${record.frameCount} steps</span>`;
  open.addEventListener("click", async () => {
    await selectRecording(record.id);
    await chrome.tabs.create({ url: chrome.runtime.getURL("render.html") });
    window.close();
  });
  const rename = document.createElement("button");
  rename.className = "saved-rename";
  rename.title = "Rename recording";
  rename.textContent = "Rename";
  rename.addEventListener("click", async () => {
    const title = window.prompt("Recording title", record.title);
    if (!title?.trim()) return;
    await renameRecording(record.id, title);
    await renderSavedRecordings();
  });
  item.append(open, rename);
  return item;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );
}

startBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const title = titleInput.value.trim() || "Recording";

  // Wait for the background to finish initializing its recording state before
  // we tell the content script to start emitting events, otherwise the very
  // first "navigate" capture can arrive before recording state exists and
  // silently drop.
  try {
    await chrome.runtime.sendMessage({
      type: "start-recording",
      tabId: tab.id,
      title,
    });
  } catch (err) {
    console.error("Background start failed:", err);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "start-recording" });
  } catch {
    // The tab predates the extension being (re)loaded, so it has no content
    // script and the first actions would silently go unrecorded. Inject it;
    // on load it sees the active recording via get-status and starts itself.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (err) {
      console.warn("Content script not available:", (err as Error).message);
    }
  }

  showRecording();
  stepCountEl.textContent = "0";
});

stopBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();

  // Tell content script to stop (best-effort)
  if (tab?.id) {
    chrome.tabs
      .sendMessage(tab.id, {
        type: "stop-recording",
        title: titleInput.value.trim() || "Recording",
      })
      .catch(() => {});
  }

  // Tell background to stop and export the zip
  try {
    await chrome.runtime.sendMessage({ type: "stop-recording" });
  } catch (err) {
    console.error("Stop failed:", err);
  }

  showIdle();
  exportNote.classList.remove("hidden");
});

// Poll frame count from background while recording
setInterval(async () => {
  if (recordingView.classList.contains("hidden")) return;
  try {
    const resp = (await chrome.runtime.sendMessage({ type: "get-status" })) as {
      recording: boolean;
      stepCount: number;
    };
    if (resp) {
      stepCountEl.textContent = String(resp.stepCount);
    }
  } catch {
    // ignore
  }
}, 1000);

void Promise.all([checkStatus(), renderSavedRecordings()]);
import {
  listRecordings,
  renameRecording,
  selectRecording,
  type RecordingListItem,
} from "@demoscope/browser-kit";
