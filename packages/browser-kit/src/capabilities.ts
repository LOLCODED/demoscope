import { isMp4Supported, isWebmSupported } from "./webcodecs-encoder.js";

export type Surface = "extension" | "web";

/**
 * Runtime feature detection that drives which controls the editor exposes.
 * Where WebCodecs `VideoEncoder` is unavailable, `canEncodeMp4` is false and
 * the UI falls back to GIF + raw WebM instead of showing a broken MP4 button.
 */
export interface Capabilities {
  surface: Surface;
  canEncodeMp4: boolean;
  canEncodeWebm: boolean;
  canEncodeGif: boolean;
  canDownloadRawWebm: boolean;
  canRecord: boolean;
  persistEdits: boolean;
}

export function detectCapabilities(
  surface: Surface,
  opts: { hasVideo?: boolean; canRecord?: boolean; persistEdits?: boolean } = {}
): Capabilities {
  return {
    surface,
    canEncodeMp4: isMp4Supported(),
    canEncodeWebm: isWebmSupported(),
    canEncodeGif: true,
    canDownloadRawWebm: opts.hasVideo ?? false,
    canRecord: opts.canRecord ?? surface === "extension",
    persistEdits: opts.persistEdits ?? surface === "extension",
  };
}
