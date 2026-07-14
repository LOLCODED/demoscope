import type { CompositedFrame } from "@demoscope/timeline";
import { CanvasCompositor } from "./canvas-compositor.js";
import { createEncoder, type OutputFormat } from "./webcodecs-encoder.js";
import type { OutputDims } from "./frame-dims.js";
import type { FrameSource } from "./frame-source.js";

export interface EncodeOptions {
  source: FrameSource;
  dims: OutputDims;
  fps: number;
  frames: CompositedFrame[];
  keyOf: (frame: CompositedFrame) => number;
  format: OutputFormat;
  onProgress?: (fraction: number, label: string) => void;
}

/**
 * Composite each timeline frame onto a canvas and stream it into the chosen
 * encoder. Shared by the extension export view and the web app so both produce
 * byte-identical output from the same edit model.
 */
export async function encodeRecording(opts: EncodeOptions): Promise<Blob> {
  const { source, dims, fps, frames, keyOf, format, onProgress } = opts;
  const compositor = new CanvasCompositor({
    sourceWidth: source.width,
    sourceHeight: dims.sourceContentHeight,
    scale: dims.scale,
    sourceTop: dims.sourceTop,
    outputWidth: dims.outputWidth,
    outputHeight: dims.outputHeight,
  });
  await compositor.init();

  const encoder = await createEncoder(format, {
    width: dims.outputWidth,
    height: dims.outputHeight,
    fps,
  });

  for (let i = 0; i < frames.length; i++) {
    const image = await source.get(keyOf(frames[i]));
    await compositor.drawFrame(frames[i], image);
    await encoder.addFrame(compositor.canvas, i);
    if (i % 5 === 0 || i === frames.length - 1) {
      onProgress?.(
        (i + 1) / frames.length,
        `Rendering frame ${i + 1} of ${frames.length}…`
      );
    }
  }

  onProgress?.(1, "Finalizing…");
  return encoder.finish();
}
