/**
 * Filming page: mounts the shared EditorApp on a plain http origin so the
 * extension can record it like any web page. Seeds the origin's IndexedDB
 * with the sample recording served at /sample/ before mounting.
 */
import { mount } from "svelte";
import { EditorApp } from "@demoscope/editor";
import {
  saveRecordingRecord,
  saveVideoBlob,
  listRecordings,
} from "@demoscope/browser-kit";

declare global {
  interface Window {
    __filmReady?: boolean;
  }
}

async function seed(): Promise<void> {
  const existing = await listRecordings();
  if (existing.length > 0) return;
  const [webm, manifest] = await Promise.all([
    fetch("/sample/video.webm").then((r) => r.blob()),
    fetch("/sample/manifest.json").then((r) => r.json()),
  ]);
  await saveVideoBlob(
    new Blob([webm], { type: manifest.video?.mime ?? "video/webm" })
  );
  await saveRecordingRecord({
    title: "Invite flow walkthrough",
    mode: "video",
    manifest,
  });
}

async function boot(): Promise<void> {
  localStorage.setItem("demoscope-theme", "light");
  await seed();
  mount(EditorApp, {
    target: document.getElementById("app")!,
    props: { surface: "extension" },
  });
  window.__filmReady = true;
}

void boot();
