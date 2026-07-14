import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export type OutputFormat = "mp4" | "webm" | "gif";

export interface EncoderOptions {
  width: number;
  height: number;
  fps: number;
}

/** A streaming sink: feed it composited frames one at a time, then finish(). */
export interface EncoderSink {
  addFrame(source: CanvasImageSource, index: number): Promise<void>;
  finish(): Promise<Blob>;
}

export function isMp4Supported(): boolean {
  return typeof VideoEncoder !== "undefined";
}

/** WebM rides MediaRecorder + canvas capture, so it works where WebCodecs
 * H.264 doesn't (Firefox, Chromium builds without proprietary codecs). */
export function isWebmSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype &&
    MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
  );
}

/**
 * Encode composited frames to WebM (VP9) via MediaRecorder. The recorder
 * stamps frames with wall-clock time, so frames are fed at the real frame
 * rate — encoding takes roughly the clip's duration, in exchange for running
 * on every browser (no WebCodecs requirement).
 */
export function createWebmEncoder(opts: EncoderOptions): EncoderSink {
  const { width, height, fps } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: Math.min(
      8_000_000,
      Math.max(1_000_000, Math.round(width * height * fps * 0.15))
    ),
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  const frameMs = 1000 / fps;
  let nextDue = performance.now();

  return {
    async addFrame(source) {
      const now = performance.now();
      if (now < nextDue) await new Promise((r) => setTimeout(r, nextDue - now));
      nextDue = Math.max(nextDue + frameMs, performance.now());
      ctx.drawImage(source, 0, 0, width, height);
      track.requestFrame();
    },
    async finish() {
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.stop();
      track.stop();
      await stopped;
      return new Blob(chunks, { type: "video/webm" });
    },
  };
}

/** Pick the highest AVC profile/level the hardware/software encoder accepts. */
async function pickAvcCodec(width: number, height: number): Promise<string> {
  const candidates = [
    "avc1.640034",
    "avc1.640028",
    "avc1.4D0028",
    "avc1.42E028",
    "avc1.42E01E",
  ];
  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
      });
      if (support.supported) return codec;
    } catch {
      // Try the next candidate.
    }
  }
  return "avc1.42E01E";
}

export async function createMp4Encoder(
  opts: EncoderOptions
): Promise<EncoderSink> {
  const { width, height, fps } = opts;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });

  const codec = await pickAvcCodec(width, height);
  const bitrate = Math.min(
    24_000_000,
    Math.max(2_000_000, Math.round(width * height * fps * 0.2))
  );
  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  const frameDuration = Math.round(1_000_000 / fps);
  const keyEvery = Math.max(1, fps * 2);

  return {
    async addFrame(source, index) {
      // Respect encoder backpressure so we don't balloon GPU memory.
      while (encoder.encodeQueueSize > 4) {
        await new Promise((r) => setTimeout(r));
      }
      const frame = new VideoFrame(source, {
        timestamp: index * frameDuration,
        duration: frameDuration,
      });
      encoder.encode(frame, { keyFrame: index % keyEvery === 0 });
      frame.close();
    },
    async finish() {
      await encoder.flush();
      muxer.finalize();
      return new Blob([muxer.target.buffer], { type: "video/mp4" });
    },
  };
}

export function createGifEncoder(opts: EncoderOptions): EncoderSink {
  const { width, height, fps } = opts;
  // GIF tops out around 15fps and gets heavy at large sizes, so drop frames to
  // hit the target rate and cap the width (mirrors the CLI's gif handling).
  const gifFps = Math.min(fps, 15);
  const step = Math.max(1, Math.round(fps / gifFps));
  const delay = Math.round(1000 / gifFps);
  const maxWidth = 960;
  const gifScale = width > maxWidth ? maxWidth / width : 1;
  const gw = Math.round(width * gifScale);
  const gh = Math.round(height * gifScale);

  const gif = GIFEncoder();
  const canvas = document.createElement("canvas");
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  return {
    async addFrame(source, index) {
      if (index % step !== 0) return;
      ctx.drawImage(source, 0, 0, gw, gh);
      const { data } = ctx.getImageData(0, 0, gw, gh);
      const palette = quantize(data, 256);
      const indexed = applyPalette(data, palette);
      gif.writeFrame(indexed, gw, gh, { palette, delay });
    },
    async finish() {
      gif.finish();
      return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
    },
  };
}

export async function createEncoder(
  format: OutputFormat,
  opts: EncoderOptions
): Promise<EncoderSink> {
  if (format === "mp4") return createMp4Encoder(opts);
  if (format === "webm") return createWebmEncoder(opts);
  return createGifEncoder(opts);
}
