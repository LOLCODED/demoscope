import { chromium, type Browser, type Page } from "playwright";
import {
  type StepFile,
  type StepAction,
  type CapturedFrame,
  type CaptureManifest,
} from "@demoscope/schema";
import { captureFrame } from "./capturer.js";

export interface RunOptions {
  outputDir: string;
  fps?: number;
  headless?: boolean;
}

export async function runSteps(
  stepFile: StepFile,
  options: RunOptions
): Promise<CaptureManifest> {
  const { meta, steps } = stepFile;
  const fps = options.fps ?? 30;
  const defaultWait = meta.defaultWait ?? 500;

  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext({
    viewport: meta.viewport,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const frames: CapturedFrame[] = [];
  let frameIndex = 0;
  const startTime = Date.now();

  const capture = async (
    step: StepAction,
    cursorX: number,
    cursorY: number,
    extra?: Partial<CapturedFrame>
  ): Promise<void> => {
    const frame = await captureFrame(page, {
      outputDir: options.outputDir,
      index: frameIndex,
      timestamp: Date.now() - startTime,
      cursorX,
      cursorY,
      stepId: step.id,
      action: step.action,
      zoom: step.zoom
        ? {
            level: step.zoom.level,
            padding: step.zoom.padding ?? 40,
            centerX: cursorX,
            centerY: cursorY,
          }
        : undefined,
      annotation: step.annotation,
      ...extra,
    });
    frames.push(frame);
    frameIndex++;
  };

  for (const step of steps) {
    await executeStep(page, step, defaultWait, capture);
  }

  await browser.close();

  return { meta, fps, frames };
}

async function executeStep(
  page: Page,
  step: StepAction,
  defaultWait: number,
  capture: (
    step: StepAction,
    cursorX: number,
    cursorY: number,
    extra?: Partial<CapturedFrame>
  ) => Promise<void>
): Promise<void> {
  const wait = step.wait ?? defaultWait;

  switch (step.action) {
    case "navigate": {
      await page.goto(step.url.startsWith("http") ? step.url : step.url);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(wait);
      const vp = page.viewportSize()!;
      await capture(step, vp.width / 2, vp.height / 2);
      break;
    }

    case "click": {
      const loc = page.locator(step.selector);
      const box = await loc.boundingBox();
      if (!box) throw new Error(`Element not found: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Capture frame before click (cursor moving to element)
      await capture(step, cx, cy);

      await loc.click();
      await sleep(wait);

      // Capture frame after click
      await capture(step, cx, cy, { isClick: true });
      break;
    }

    case "type": {
      const loc = page.locator(step.selector);
      const box = await loc.boundingBox();
      if (!box) throw new Error(`Element not found: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Click to focus
      await loc.click();
      await sleep(100);

      // Type character by character, capturing frames
      const delay = step.typeDelay ?? 80;
      for (const char of step.text) {
        await page.keyboard.type(char, { delay: 0 });
        await sleep(delay);
        await capture(step, cx, cy);
      }

      await sleep(wait);
      await capture(step, cx, cy);
      break;
    }

    case "scroll": {
      const target = step.selector
        ? page.locator(step.selector)
        : page.locator("body");
      const box = await target.boundingBox();
      const cx = box ? box.x + box.width / 2 : 640;
      const cy = box ? box.y + box.height / 2 : 360;

      // Capture before scroll
      await capture(step, cx, cy);

      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, step.deltaY);
      await sleep(wait);

      // Capture after scroll
      await capture(step, cx, cy);
      break;
    }

    case "wait": {
      const vp = page.viewportSize()!;
      await capture(step, vp.width / 2, vp.height / 2);
      await sleep(step.duration);
      await capture(step, vp.width / 2, vp.height / 2);
      break;
    }

    case "hover": {
      const loc = page.locator(step.selector);
      const box = await loc.boundingBox();
      if (!box) throw new Error(`Element not found: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await loc.hover();
      await sleep(wait);
      await capture(step, cx, cy);
      break;
    }

    case "select": {
      const loc = page.locator(step.selector);
      const box = await loc.boundingBox();
      if (!box) throw new Error(`Element not found: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await loc.selectOption(step.value);
      await sleep(wait);
      await capture(step, cx, cy);
      break;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
