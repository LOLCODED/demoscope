#!/usr/bin/env node

import { Command } from "commander";
import { run } from "@demoscope/runner";
import { renderPipeline } from "@demoscope/renderer";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, extname } from "node:path";

const program = new Command();

program
  .name("demoscope")
  .description("Create polished product walkthrough videos from step definitions")
  .version("0.1.0");

program
  .command("run")
  .description("Replay a step file in a browser and capture frames")
  .argument("<stepfile>", "Path to steps.json or steps.yaml")
  .option("-o, --output <dir>", "Output directory for captured frames", "./capture")
  .option("--fps <number>", "Frames per second", "30")
  .option("--headed", "Run browser in headed mode (visible)")
  .option("--timeout <ms>", "Timeout for waiting on elements (ms)", "10000")
  .option("--fail-fast", "Abort on first step failure instead of skipping")
  .action(async (stepfile: string, opts: { output: string; fps: string; headed?: boolean; timeout: string; failFast?: boolean }) => {
    try {
      await run(stepfile, opts.output, {
        fps: parseInt(opts.fps, 10),
        headless: !opts.headed,
        timeout: parseInt(opts.timeout, 10),
        skipErrors: !opts.failFast,
      });
    } catch (err) {
      console.error("Run failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("render")
  .description("Render captured frames into a video or GIF. Accepts a directory or .zip file.")
  .argument("<input>", "Path to capture directory or .zip file from extension")
  .option("-o, --output <file>", "Output file path", "./output.mp4")
  .option("-f, --format <fmt>", "Output format: mp4 or gif", "mp4")
  .option("--fps <number>", "Frames per second", "30")
  .option("--width <number>", "Output width in pixels")
  .option("--transition <ms>", "Zoom transition duration in ms", "500")
  .option("--hold <ms>", "Hold time per step (ms)", "500")
  .option("--annotation-hold <ms>", "Hold time when annotation shown (ms)", "1500")
  .option("--intro-hold <ms>", "Hold time on the first frame (ms)", "1500")
  .option("--cursor-size <px>", "Cursor size in pixels", "24")
  .option("--click-cursor <style>", "Cursor shape on click frames: arrow or pointer", "arrow")
  .option("--no-annotations", "Hide annotation overlays")
  .action(
    async (
      input: string,
      opts: {
        output: string;
        format: string;
        fps: string;
        width?: string;
        transition: string;
        hold: string;
        annotationHold: string;
        introHold: string;
        cursorSize: string;
        clickCursor: string;
        annotations: boolean;
      }
    ) => {
      const format = opts.format as "mp4" | "gif";
      if (format !== "mp4" && format !== "gif") {
        console.error("Format must be mp4 or gif");
        process.exit(1);
      }

      const clickCursor = parseClickCursor(opts.clickCursor);

      let extractedDir: string | null = null;
      try {
        let captureDir = input;

        // If input is a zip, extract to a temp directory
        if (extname(input).toLowerCase() === ".zip") {
          captureDir = input.replace(/\.zip$/i, "");
          extractedDir = captureDir;
          console.log(`Extracting ${input}...`);
          await extractZip(input, captureDir);
        }

        await renderPipeline(captureDir, {
          outputPath: opts.output,
          format,
          fps: parseInt(opts.fps, 10),
          width: opts.width ? parseInt(opts.width, 10) : undefined,
          zoomTransitionMs: parseInt(opts.transition, 10),
          holdMs: parseInt(opts.hold, 10),
          annotationHoldMs: parseInt(opts.annotationHold, 10),
          introHoldMs: parseInt(opts.introHold, 10),
          cursorSize: parseInt(opts.cursorSize, 10),
          clickCursor,
          showAnnotations: opts.annotations,
        });
      } finally {
        // Clean up extracted zip directory
        if (extractedDir) {
          await rm(extractedDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  );

program
  .command("demo")
  .description("Run steps and render to video in one command")
  .argument("<stepfile>", "Path to steps.json or steps.yaml")
  .option("-o, --output <file>", "Output file path", "./demo.mp4")
  .option("-f, --format <fmt>", "Output format: mp4 or gif", "mp4")
  .option("--fps <number>", "Frames per second", "30")
  .option("--width <number>", "Output width in pixels")
  .option("--headed", "Run browser in headed mode")
  .option("--timeout <ms>", "Timeout for waiting on elements (ms)", "10000")
  .option("--fail-fast", "Abort on first step failure instead of skipping")
  .option("--capture-dir <dir>", "Directory for intermediate capture", "./.demoscope-capture")
  .option("--hold <ms>", "Hold time per step (ms)", "500")
  .option("--annotation-hold <ms>", "Hold time when annotation shown (ms)", "1500")
  .option("--intro-hold <ms>", "Hold time on the first frame (ms)", "1500")
  .option("--cursor-size <px>", "Cursor size in pixels", "24")
  .option("--click-cursor <style>", "Cursor shape on click frames: arrow or pointer", "arrow")
  .option("--no-annotations", "Hide annotation overlays")
  .action(
    async (
      stepfile: string,
      opts: {
        output: string;
        format: string;
        fps: string;
        width?: string;
        headed?: boolean;
        timeout: string;
        failFast?: boolean;
        captureDir: string;
        hold: string;
        annotationHold: string;
        introHold: string;
        cursorSize: string;
        clickCursor: string;
        annotations: boolean;
      }
    ) => {
      const format = opts.format as "mp4" | "gif";
      if (format !== "mp4" && format !== "gif") {
        console.error("Format must be mp4 or gif");
        process.exit(1);
      }

      const fps = parseInt(opts.fps, 10);
      const clickCursor = parseClickCursor(opts.clickCursor);

      try {
        console.log("Step 1/2: Capturing frames...");
        await run(stepfile, opts.captureDir, {
          fps,
          headless: !opts.headed,
          timeout: parseInt(opts.timeout, 10),
          skipErrors: !opts.failFast,
        });

        console.log("Step 2/2: Rendering video...");
        await renderPipeline(opts.captureDir, {
          outputPath: opts.output,
          format,
          fps,
          width: opts.width ? parseInt(opts.width, 10) : undefined,
          holdMs: parseInt(opts.hold, 10),
          annotationHoldMs: parseInt(opts.annotationHold, 10),
          introHoldMs: parseInt(opts.introHold, 10),
          cursorSize: parseInt(opts.cursorSize, 10),
          clickCursor,
          showAnnotations: opts.annotations,
        });

        console.log(`Done! Output: ${opts.output}`);
      } catch (err) {
        console.error("Demo failed:", (err as Error).message);
        process.exit(1);
      } finally {
        // Clean up intermediate capture directory
        await rm(opts.captureDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  );

function parseClickCursor(value: string): "arrow" | "pointer" {
  if (value !== "arrow" && value !== "pointer") {
    console.error(`--click-cursor must be "arrow" or "pointer" (got "${value}")`);
    process.exit(1);
  }
  return value;
}

async function extractZip(zipPath: string, outDir: string): Promise<void> {
  const { resolve, normalize } = await import("node:path");
  const { unzipSync } = await import("fflate");
  const zipBuffer = await readFile(zipPath);
  const files = unzipSync(new Uint8Array(zipBuffer));

  const resolvedOut = resolve(outDir);

  for (const [filename, data] of Object.entries(files)) {
    // Reject path traversal attempts
    const normalized = normalize(filename);
    const resolvedFile = resolve(outDir, normalized);
    if (normalized.startsWith("..") || !resolvedFile.startsWith(resolvedOut + "/") && resolvedFile !== resolvedOut) {
      throw new Error(`Zip contains unsafe path: ${filename}`);
    }

    await mkdir(resolvedFile.substring(0, resolvedFile.lastIndexOf("/")), { recursive: true });
    await writeFile(resolvedFile, data);
  }
}

program.parse();
