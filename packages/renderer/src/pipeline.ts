import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type CaptureManifest, type RenderConfig } from "@demoscope/schema";
import { buildRenderTimeline, type RenderFrame } from "./transitions.js";
import { cursorOverlay, DEFAULT_CURSOR_SIZE, type CursorShape } from "./cursor.js";
import { annotationOverlay } from "./annotate.js";

const BATCH_SIZE = 20;

export async function renderPipeline(
  captureDir: string,
  config: RenderConfig
): Promise<void> {
  const manifestPath = join(captureDir, "capture-manifest.json");
  const raw = await readFile(manifestPath, "utf-8");
  const manifest: CaptureManifest = JSON.parse(raw);

  const { width: vw, height: vh } = manifest.meta.viewport;

  // Read actual image dimensions from first frame to detect true scale
  const firstImagePath = join(captureDir, manifest.frames[0].path);
  const firstImageMeta = await sharp(await readFile(firstImagePath)).metadata();
  const actualImgW = firstImageMeta.width!;
  const actualImgH = firstImageMeta.height!;
  const scale = Math.round(actualImgW / vw) || 2;
  const scaledVw = actualImgW;
  const scaledVh = actualImgH;

  // Force even dimensions (h264 requirement)
  const outputWidth = toEven(config.width ?? vw);
  const outputHeight = toEven(Math.round(outputWidth * (actualImgH / actualImgW)));

  const showAnnotations = config.showAnnotations ?? true;
  const cursorSize = Math.max(8, config.cursorSize ?? DEFAULT_CURSOR_SIZE);
  const clickCursor: CursorShape = config.clickCursor ?? "arrow";
  const timeline = buildRenderTimeline(manifest, {
    transitionMs: config.zoomTransitionMs ?? 500,
    holdMs: config.holdMs ?? 500,
    annotationHoldMs: config.annotationHoldMs ?? 1500,
    introHoldMs: config.introHoldMs ?? 1500,
    showAnnotations,
  });

  const renderedDir = join(captureDir, "rendered");
  await mkdir(renderedDir, { recursive: true });

  console.log(`Rendering ${timeline.length} frames...`);

  // Process in batches for memory efficiency
  for (let batch = 0; batch < timeline.length; batch += BATCH_SIZE) {
    const batchEnd = Math.min(batch + BATCH_SIZE, timeline.length);
    const promises: Promise<void>[] = [];

    for (let i = batch; i < batchEnd; i++) {
      promises.push(
        renderSingleFrame(
          timeline[i],
          i,
          manifest,
          captureDir,
          renderedDir,
          scaledVw,
          scaledVh,
          outputWidth,
          outputHeight,
          scale,
          showAnnotations,
          cursorSize,
          clickCursor
        )
      );
    }

    await Promise.all(promises);

    if (batch % (BATCH_SIZE * 5) === 0 && batch > 0) {
      console.log(`  ${batch}/${timeline.length} frames rendered`);
    }
  }

  console.log(`All ${timeline.length} frames rendered`);
  console.log(`Encoding ${config.format}...`);

  const { encode } = await import("./encode.js");
  await encode({
    framesDir: renderedDir,
    outputPath: config.outputPath,
    format: config.format,
    fps: config.fps,
    width: config.format === "gif" ? toEven(Math.min(outputWidth, 960)) : undefined,
  });

  console.log(`Output written to ${config.outputPath}`);
}

async function renderSingleFrame(
  renderFrame: RenderFrame,
  outputIndex: number,
  manifest: CaptureManifest,
  captureDir: string,
  renderedDir: string,
  scaledVw: number,
  scaledVh: number,
  outputWidth: number,
  outputHeight: number,
  scale: number,
  showAnnotations: boolean,
  cursorSize: number,
  clickCursor: CursorShape
): Promise<void> {
  const sourceFrame = manifest.frames[renderFrame.sourceIndex];
  const imagePath = join(captureDir, sourceFrame.path);
  const imageBuffer = await readFile(imagePath);

  const { zoomRect } = renderFrame;

  // Scale the zoom rect to match the high-res screenshot
  const extractLeft = Math.max(0, Math.min(zoomRect.x * scale, scaledVw - zoomRect.w * scale));
  const extractTop = Math.max(0, Math.min(zoomRect.y * scale, scaledVh - zoomRect.h * scale));
  const extractWidth = Math.min(zoomRect.w * scale, scaledVw - extractLeft);
  const extractHeight = Math.min(zoomRect.h * scale, scaledVh - extractTop);

  // Ensure dimensions are at least 1
  const safeWidth = Math.max(1, Math.round(extractWidth));
  const safeHeight = Math.max(1, Math.round(extractHeight));

  const img = sharp(imageBuffer)
    .extract({
      left: Math.round(extractLeft),
      top: Math.round(extractTop),
      width: safeWidth,
      height: safeHeight,
    })
    .resize(outputWidth, outputHeight, { fit: "fill" });

  // Compute cursor position relative to the zoomed/cropped frame
  const relCursorX =
    ((renderFrame.cursorX - zoomRect.x) / zoomRect.w) * outputWidth;
  const relCursorY =
    ((renderFrame.cursorY - zoomRect.y) / zoomRect.h) * outputHeight;

  // Collect overlays and composite them in a single call. Sharp's
  // .composite() replaces prior composite settings when called again,
  // so stacking them in separate calls would drop the cursor on any
  // frame that also has an annotation.
  const shape: CursorShape =
    renderFrame.isClick && clickCursor === "pointer" ? "pointer" : "arrow";
  const overlays: sharp.OverlayOptions[] = [
    cursorOverlay(relCursorX, relCursorY, shape, cursorSize),
  ];
  if (showAnnotations && renderFrame.annotation) {
    overlays.push(
      annotationOverlay(renderFrame.annotation, outputWidth, outputHeight)
    );
  }

  const outputPath = join(
    renderedDir,
    `render-${String(outputIndex).padStart(4, "0")}.png`
  );
  await img.composite(overlays).png().toFile(outputPath);
}

/** Round to nearest even number (h264 requires even width/height) */
function toEven(n: number): number {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}
