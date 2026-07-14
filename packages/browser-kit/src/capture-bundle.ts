import { zipSync, strToU8 } from "fflate";

export interface CapturedFrame {
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
  /** Continuous-video mode: ms into the recorded video for this interaction. */
  videoTimeMs?: number;
}

export interface CaptureMeta {
  title?: string;
  baseUrl: string;
  viewport: { width: number; height: number };
  defaultWait?: number;
}

export interface CaptureVideoMeta {
  mime: string;
  durationMs: number;
}

export interface CaptureManifest {
  meta: CaptureMeta;
  fps: number;
  frames: CapturedFrame[];
  video?: CaptureVideoMeta;
}

/** Decode a `data:...;base64,...` URL into its raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Turn a title into a filesystem-safe slug for download filenames. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the CLI-compatible capture bundle (manifest + PNG frames) as a zip.
 * Shared so the render page can offer a "download zip" export without the
 * background service worker needing to build it. Screenshot mode only.
 */
export function buildCaptureZip(
  manifest: CaptureManifest,
  images: string[]
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "capture-manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  };
  for (let i = 0; i < images.length; i++) {
    files[`frames/frame-${String(i).padStart(4, "0")}.png`] = dataUrlToBytes(
      images[i]
    );
  }
  return zipSync(files, { level: 1 });
}

/**
 * Bundle a continuous-video recording (webm + its manifest) as a zip so the
 * cinematics metadata — clicks, annotations, timings — travels with the video.
 * The web app editor reloads this to re-derive zooms and subtitles; a bare webm
 * would lose them. The webm is stored uncompressed (it already is).
 */
export function buildVideoBundle(
  manifest: CaptureManifest,
  webm: Uint8Array
): Uint8Array {
  return zipSync(
    {
      "capture-manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "recording.webm": [webm, { level: 0 }],
    },
    { level: 1 }
  );
}
