import { chromium, type Page } from "playwright";
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
  /** Timeout in ms for waiting on elements. Default 10000. */
  timeout?: number;
  /** Skip steps that fail instead of aborting. Default true. */
  skipErrors?: boolean;
}

export async function runSteps(
  stepFile: StepFile,
  options: RunOptions
): Promise<CaptureManifest> {
  const { meta, steps } = stepFile;
  const fps = options.fps ?? 30;
  const defaultWait = meta.defaultWait ?? 500;
  const timeout = options.timeout ?? 10000;
  const skipErrors = options.skipErrors ?? true;

  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext({
    viewport: meta.viewport,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

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

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = step.id || `step ${i + 1}`;
    try {
      await executeStep(page, step, defaultWait, timeout, capture);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ Step "${label}" (${step.action}) failed: ${msg}`);
      if (!skipErrors) {
        await browser.close();
        throw err;
      }
      // Capture current page state as a frame anyway, so the video isn't broken
      const vp = page.viewportSize()!;
      await capture(step, vp.width / 2, vp.height / 2);
    }
  }

  await browser.close();

  if (frames.length === 0) {
    throw new Error("No frames captured — all steps failed");
  }

  return { meta, fps, frames };
}

/**
 * Wait for a selector to be visible, returning the bounding box.
 * Returns null if the element can't be found within the timeout.
 */
async function waitForElement(
  page: Page,
  selector: string,
  timeout: number
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const loc = page.locator(selector).first();
  try {
    await loc.waitFor({ state: "visible", timeout });
  } catch {
    // Try attached (element exists but may be offscreen)
    try {
      await loc.waitFor({ state: "attached", timeout: 2000 });
    } catch {
      return null;
    }
  }
  return loc.boundingBox();
}

async function executeStep(
  page: Page,
  step: StepAction,
  defaultWait: number,
  timeout: number,
  capture: (
    step: StepAction,
    cursorX: number,
    cursorY: number,
    extra?: Partial<CapturedFrame>
  ) => Promise<void>
): Promise<void> {
  const wait = step.wait ?? defaultWait;
  const vp = page.viewportSize()!;

  switch (step.action) {
    case "navigate": {
      await page.goto(step.url.startsWith("http") ? step.url : step.url);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(wait);
      await capture(step, vp.width / 2, vp.height / 2);
      break;
    }

    case "click": {
      const box = await waitForElement(page, step.selector, timeout);
      if (!box) throw new Error(`Element not found or not visible: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await capture(step, cx, cy);
      await page.locator(step.selector).first().click({ timeout });
      await sleep(wait);
      await capture(step, cx, cy, { isClick: true });
      break;
    }

    case "type": {
      const box = await waitForElement(page, step.selector, timeout);
      if (!box) throw new Error(`Element not found or not visible: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await page.locator(step.selector).first().click({ timeout });
      await sleep(100);

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
      let cx = vp.width / 2;
      let cy = vp.height / 2;

      if (step.selector) {
        const box = await waitForElement(page, step.selector, timeout);
        if (box) {
          cx = box.x + box.width / 2;
          cy = box.y + box.height / 2;
        }
      }

      await capture(step, cx, cy);
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, step.deltaY);
      await sleep(wait);
      await capture(step, cx, cy);
      break;
    }

    case "wait": {
      await capture(step, vp.width / 2, vp.height / 2);
      await sleep(step.duration);
      await capture(step, vp.width / 2, vp.height / 2);
      break;
    }

    case "hover": {
      const box = await waitForElement(page, step.selector, timeout);
      if (!box) throw new Error(`Element not found or not visible: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await page.locator(step.selector).first().hover({ timeout });
      await sleep(wait);
      await capture(step, cx, cy);
      break;
    }

    case "select": {
      const box = await waitForElement(page, step.selector, timeout);
      if (!box) throw new Error(`Element not found or not visible: ${step.selector}`);

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await page.locator(step.selector).first().selectOption(step.value, { timeout });
      await sleep(wait);
      await capture(step, cx, cy);
      break;
    }

    case "keypress": {
      // If a selector is provided, focus that element first
      let cx = vp.width / 2;
      let cy = vp.height / 2;

      if (step.selector) {
        const box = await waitForElement(page, step.selector, timeout);
        if (box) {
          cx = box.x + box.width / 2;
          cy = box.y + box.height / 2;
          await page.locator(step.selector).first().click({ timeout });
          await sleep(100);
        }
      }

      await capture(step, cx, cy);
      await page.keyboard.press(step.key);
      await sleep(wait);

      // Wait for any navigation triggered by the keypress (e.g. Enter on a search)
      await page.waitForLoadState("networkidle").catch(() => {});
      await capture(step, cx, cy);
      break;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
