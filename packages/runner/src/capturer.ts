import { type Page } from "playwright";
import { type CapturedFrame } from "@demoscope/schema";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface CaptureOptions {
  outputDir: string;
  index: number;
  timestamp: number;
  cursorX: number;
  cursorY: number;
  stepId?: string;
  action?: string;
  zoom?: {
    level: number;
    padding: number;
    centerX: number;
    centerY: number;
  };
  annotation?: string;
  isClick?: boolean;
}

export async function captureFrame(
  page: Page,
  options: CaptureOptions
): Promise<CapturedFrame> {
  const framesDir = join(options.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const filename = `frame-${String(options.index).padStart(4, "0")}.png`;
  const filepath = join(framesDir, filename);

  const buffer = await page.screenshot({ type: "png" });
  await writeFile(filepath, buffer);

  return {
    path: `frames/${filename}`,
    index: options.index,
    timestamp: options.timestamp,
    cursorX: options.cursorX,
    cursorY: options.cursorY,
    stepId: options.stepId,
    action: options.action,
    zoom: options.zoom,
    annotation: options.annotation,
    isClick: options.isClick,
  };
}
