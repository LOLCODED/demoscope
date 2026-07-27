// Owns the tab-capture MediaStream + MediaRecorder for a single recording.
// Runs inside the offscreen document because a Chrome service worker has no
// DOM and cannot host MediaRecorder. The webm blob it produces is read back
// frame-by-frame at render time (see VideoSeekFrameSource), so the container
// only needs to be seekable — MediaRecorder's infinite-duration webm is fine.

export interface StopResult {
  blob: Blob;
  /** Epoch (ms) when capture began — anchors event timings to the video clock. */
  videoStartEpoch: number;
  /** Wall-clock capture length. MediaRecorder webm reports an unreliable
   * duration until fully indexed, so we measure it ourselves. */
  durationMs: number;
  mime: string;
}

// vp9 gives the best quality/size; fall back down for builds without it.
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickMimeType(): string {
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "video/webm";
}

export class RecorderSession {
  readonly videoStartEpoch: number;

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly chunks: Blob[]
  ) {
    this.videoStartEpoch = Date.now();
  }

  static start(stream: MediaStream): RecorderSession {
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    // Flush a chunk per second so long recordings don't buffer as one blob and
    // so a crash still leaves a partially-recoverable file.
    recorder.start(1000);
    return new RecorderSession(stream, recorder, chunks);
  }

  stop(): Promise<StopResult> {
    return new Promise((resolve) => {
      const finish = () => {
        this.stream.getTracks().forEach((track) => track.stop());
        resolve({
          blob: new Blob(this.chunks, { type: "video/webm" }),
          videoStartEpoch: this.videoStartEpoch,
          durationMs: Date.now() - this.videoStartEpoch,
          mime: "video/webm",
        });
      };
      if (this.recorder.state === "inactive") {
        finish();
        return;
      }
      this.recorder.onstop = finish;
      this.recorder.stop();
    });
  }
}
