import {
  deriveVideoEditModel,
  type CompositedFrame,
  type VideoEditModel,
  type VideoRenderFrame,
} from "@demoscope/timeline";
import { unzipSync, strFromU8 } from "fflate";
import {
  StepFrameSource,
  VideoSeekFrameSource,
  type FrameSource,
} from "./frame-source.js";
import { computeOutputDims, type OutputDims } from "./frame-dims.js";
import type { CaptureManifest } from "./capture-bundle.js";
import { loadRecordingRecord, loadVideoBlob } from "./recording-store.js";

/** A recording ready to hand to the editor, whatever file it came from. */
export interface LoadedRecording {
  mode: "video" | "screenshot";
  source: FrameSource;
  manifest: CaptureManifest;
  title: string;
  fps: number;
  dims: OutputDims;
  /** Editable cinematics model (video mode). */
  model?: VideoEditModel;
  /** Pre-built render frames (screenshot mode; non-editable timeline). */
  frames: CompositedFrame[];
  keyOf: (frame: CompositedFrame) => number;
  images?: string[];
  videoBlob?: Blob;
}

const videoOptions = () => ({
  transitionMs: 500,
  holdMs: 1200,
  annotationHoldMs: 2000,
  cursorGlideMs: 400,
  showAnnotations: true,
});

const isVideo = (file: File) =>
  file.type.startsWith("video/") || /\.(webm|mp4|mov)$/i.test(file.name);
const isJson = (file: File) => /\.json$/i.test(file.name);
const isZip = (file: File) => /\.zip$/i.test(file.name);

const titleFrom = (file: File) =>
  file.name.replace(/\.[^.]+$/, "") || "Recording";

/** Resolve one or more dropped files into a single loadable recording. */
export async function loadFiles(files: File[]): Promise<LoadedRecording> {
  const video = files.find(isVideo);
  const json = files.find(isJson);
  const zip = files.find(isZip);
  if (video) return loadVideo(video, json);
  if (zip) return loadZip(zip);
  if (json)
    throw new Error(
      "A capture manifest needs its frames — drop the .zip bundle or pair the .json with a .webm video."
    );
  throw new Error(
    "Unsupported file. Drop a .webm video or a capture .zip bundle."
  );
}

async function loadVideo(
  file: File,
  manifestFile?: File
): Promise<LoadedRecording> {
  const source = await VideoSeekFrameSource.create(file);
  const manifest = manifestFile
    ? await readManifest(manifestFile)
    : syntheticManifest(source, file.type);
  return buildVideoRecording(
    source,
    manifest,
    manifest.meta.title ?? titleFrom(file),
    file
  );
}

async function buildVideoRecording(
  source: VideoSeekFrameSource,
  manifest: CaptureManifest,
  title: string,
  blob: Blob
): Promise<LoadedRecording> {
  const model = deriveVideoEditModel(manifest, videoOptions());
  const dims = await computeOutputDims(source, manifest.meta.viewport.width);
  return {
    mode: "video",
    source,
    manifest,
    title,
    fps: manifest.fps,
    dims,
    model,
    frames: [],
    keyOf: (frame) => (frame as VideoRenderFrame).videoTimeMs,
    videoBlob: blob,
  };
}

async function loadZip(file: File): Promise<LoadedRecording> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes =
    entries["capture-manifest.json"] ?? entries["manifest.json"];
  if (!manifestBytes)
    throw new Error("Bundle is missing capture-manifest.json");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as CaptureManifest;
  const title = manifest.meta.title ?? titleFrom(file);

  // Video bundle: a webm alongside the manifest (re-derives full cinematics).
  const webmName = Object.keys(entries).find((name) => /\.webm$/i.test(name));
  if (webmName) {
    const blob = new Blob([entries[webmName] as BlobPart], {
      type: manifest.video?.mime ?? "video/webm",
    });
    const source = await VideoSeekFrameSource.create(blob);
    return buildVideoRecording(source, manifest, title, blob);
  }

  // Screenshot bundle: PNG frames become a time-stepped, editable model.
  const frameNames = Object.keys(entries)
    .filter((name) => /frames\/.*\.png$/i.test(name))
    .sort();
  const bitmaps = await Promise.all(
    frameNames.map((name) =>
      createImageBitmap(
        new Blob([entries[name] as BlobPart], { type: "image/png" })
      )
    )
  );
  if (bitmaps.length === 0) throw new Error("Bundle has no frame images");
  return buildScreenshotRecording(bitmaps, manifest, title);
}

/**
 * Turn a screenshot capture into a time-stepped, editable recording so the same
 * time-based editor drives it. Each screenshot is anchored to its capture time.
 */
export async function buildScreenshotRecording(
  bitmaps: ImageBitmap[],
  manifest: CaptureManifest,
  title: string
): Promise<LoadedRecording> {
  const frames = manifest.frames.map((frame) => ({
    ...frame,
    videoTimeMs: frame.videoTimeMs ?? frame.timestamp,
  }));
  const timedManifest = { ...manifest, frames };
  const source = new StepFrameSource(
    bitmaps,
    frames.map((frame) => frame.videoTimeMs)
  );
  const model = deriveVideoEditModel(timedManifest, videoOptions());
  const dims = await computeOutputDims(source, manifest.meta.viewport.width);
  return {
    mode: "screenshot",
    source,
    manifest: timedManifest,
    title,
    fps: manifest.fps,
    dims,
    model,
    frames: [],
    keyOf: (frame) => (frame as VideoRenderFrame).videoTimeMs,
  };
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

/**
 * Load the active stored recording (set by the recorder / library) into an
 * editor-ready recording. Returns null when nothing has been recorded yet.
 */
export async function loadActiveRecording(): Promise<LoadedRecording | null> {
  const record = await loadRecordingRecord();
  if (!record) return null;
  const { manifest, title } = record;
  if (record.mode === "video") {
    const blob = await loadVideoBlob();
    if (!blob) throw new Error("recorded video missing");
    const source = await VideoSeekFrameSource.create(blob);
    return buildVideoRecording(source, manifest, title, blob);
  }
  const images = record.images ?? [];
  const bitmaps = await Promise.all(images.map(dataUrlToBitmap));
  const loaded = await buildScreenshotRecording(bitmaps, manifest, title);
  // Keep the original PNGs so the step document reuses them verbatim.
  return { ...loaded, images };
}

async function readManifest(file: File): Promise<CaptureManifest> {
  return JSON.parse(await file.text()) as CaptureManifest;
}

function syntheticManifest(
  source: VideoSeekFrameSource,
  mime: string
): CaptureManifest {
  return {
    meta: {
      baseUrl: "",
      viewport: { width: source.width, height: source.height },
    },
    fps: 30,
    frames: [],
    video: { mime: mime || "video/webm", durationMs: source.durationMs },
  };
}
