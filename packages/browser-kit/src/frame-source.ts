/**
 * Supplies the base image for each output frame. Screenshots index by frame
 * number; continuous video seeks by millisecond timestamp. Both hand the
 * compositor a `CanvasImageSource`, so the render loop is identical either way.
 */
export interface FrameSource {
  /** For screenshots: the source index. For video: the timestamp in ms. */
  get(key: number): Promise<CanvasImageSource>;
  readonly width: number;
  readonly height: number;
  dispose(): void;
}

export class BitmapFrameSource implements FrameSource {
  readonly width: number;
  readonly height: number;

  constructor(private readonly bitmaps: ImageBitmap[]) {
    this.width = bitmaps[0].width;
    this.height = bitmaps[0].height;
  }

  async get(index: number): Promise<CanvasImageSource> {
    return this.bitmaps[index];
  }

  dispose(): void {
    this.bitmaps.forEach((b) => b.close());
  }
}

/**
 * Screenshots keyed by time instead of index, so a discrete screenshot capture
 * can drive the same time-based editor as continuous video: `get(ms)` returns
 * the screenshot in effect at that moment (a step function over the frames).
 */
export class StepFrameSource implements FrameSource {
  readonly width: number;
  readonly height: number;

  constructor(
    private readonly bitmaps: ImageBitmap[],
    private readonly times: number[]
  ) {
    this.width = bitmaps[0].width;
    this.height = bitmaps[0].height;
  }

  async get(ms: number): Promise<CanvasImageSource> {
    let index = 0;
    for (let i = 0; i < this.times.length; i++) {
      if (this.times[i] <= ms) index = i;
      else break;
    }
    return this.bitmaps[index];
  }

  dispose(): void {
    this.bitmaps.forEach((b) => b.close());
  }
}

function once(el: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(el.error ?? new Error(`video ${event} failed`));
    };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
    };
    el.addEventListener(event, ok);
    el.addEventListener("error", fail);
  });
}

/**
 * Seeks an off-DOM `<video>` to each requested timestamp and hands it to the
 * compositor. Works around MediaRecorder webm files that report an infinite
 * duration until fully indexed.
 */
export class VideoSeekFrameSource implements FrameSource {
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly objectUrl: string
  ) {
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.durationMs = (isFinite(video.duration) ? video.duration : 0) * 1000;
  }

  static async create(blob: Blob): Promise<VideoSeekFrameSource> {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const objectUrl = URL.createObjectURL(blob);
    video.src = objectUrl;
    await once(video, "loadedmetadata");
    if (!isFinite(video.duration) || video.duration === 0) {
      await forceDurationResolve(video);
    }
    return new VideoSeekFrameSource(video, objectUrl);
  }

  /** The underlying element, for live preview playback in the editor. */
  get element(): HTMLVideoElement {
    return this.video;
  }

  async get(ms: number): Promise<CanvasImageSource> {
    const maxTime = this.durationMs > 0 ? this.durationMs / 1000 : Infinity;
    const target = Math.min(Math.max(ms / 1000, 0), maxTime);
    if (Math.abs(this.video.currentTime - target) > 1e-3) {
      const seeked = once(this.video, "seeked");
      this.video.currentTime = target;
      await seeked;
    }
    return this.video;
  }

  dispose(): void {
    URL.revokeObjectURL(this.objectUrl);
  }
}

/**
 * MediaRecorder output lacks a duration/seek index, so `video.duration` reads
 * Infinity. Seeking far past the end forces Chrome to index the whole file,
 * after which duration is known and arbitrary seeks work.
 */
function forceDurationResolve(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.currentTime = 0;
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = 1e101;
  });
}
