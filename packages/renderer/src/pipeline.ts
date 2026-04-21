import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type CaptureManifest, type RenderConfig } from "@demoscope/schema";
import { buildRenderTimeline, type RenderFrame } from "./transitions.js";
import { composeCursor } from "./cursor.js";
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
  // Account for deviceScaleFactor=2 in screenshots
  const scale = 2;
  const scaledVw = vw * scale;
  const scaledVh = vh * scale;

  const outputWidth = config.width ?? vw;
  const outputHeight = Math.round(outputWidth * (vh / vw));

  const transitionMs = config.zoomTransitionMs ?? 500;
  const timeline = buildRenderTimeline(manifest, transitionMs);

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
          scale
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
    width: config.format === "gif" ? Math.min(outputWidth, 960) : undefined,
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
  scale: number
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

  let img = sharp(imageBuffer)
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

  // Compose cursor overlay
  img = await composeCursor(
    img,
    relCursorX,
    relCursorY,
    renderFrame.isClick
  );

  // Add annotation if present
  if (renderFrame.annotation) {
    const overlay = annotationOverlay(
      renderFrame.annotation,
      outputWidth,
      outputHeight
    );
    img = img.composite([overlay]);
  }

  const outputPath = join(
    renderedDir,
    `render-${String(outputIndex).padStart(4, "0")}.png`
  );
  await img.png().toFile(outputPath);
}
