#!/usr/bin/env node

import { Command } from "commander";
import { run } from "@demoscope/runner";
import { renderPipeline } from "@demoscope/renderer";

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
  .action(async (stepfile: string, opts: { output: string; fps: string; headed?: boolean }) => {
    try {
      await run(stepfile, opts.output, {
        fps: parseInt(opts.fps, 10),
        headless: !opts.headed,
      });
    } catch (err) {
      console.error("Run failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("render")
  .description("Render captured frames into a video or GIF")
  .argument("<capturedir>", "Path to capture directory (from `demoscope run`)")
  .option("-o, --output <file>", "Output file path", "./output.mp4")
  .option("-f, --format <fmt>", "Output format: mp4 or gif", "mp4")
  .option("--fps <number>", "Frames per second", "30")
  .option("--width <number>", "Output width in pixels")
  .option("--transition <ms>", "Zoom transition duration in ms", "500")
  .action(
    async (
      capturedir: string,
      opts: {
        output: string;
        format: string;
        fps: string;
        width?: string;
        transition: string;
      }
    ) => {
      const format = opts.format as "mp4" | "gif";
      if (format !== "mp4" && format !== "gif") {
        console.error("Format must be mp4 or gif");
        process.exit(1);
      }

      try {
        await renderPipeline(capturedir, {
          outputPath: opts.output,
          format,
          fps: parseInt(opts.fps, 10),
          width: opts.width ? parseInt(opts.width, 10) : undefined,
          zoomTransitionMs: parseInt(opts.transition, 10),
        });
      } catch (err) {
        console.error("Render failed:", (err as Error).message);
        process.exit(1);
      }
    }
  );

// Convenience: run + render in one command
program
  .command("demo")
  .description("Run steps and render to video in one command")
  .argument("<stepfile>", "Path to steps.json or steps.yaml")
  .option("-o, --output <file>", "Output file path", "./demo.mp4")
  .option("-f, --format <fmt>", "Output format: mp4 or gif", "mp4")
  .option("--fps <number>", "Frames per second", "30")
  .option("--width <number>", "Output width in pixels")
  .option("--headed", "Run browser in headed mode")
  .option("--capture-dir <dir>", "Directory for intermediate capture", "./.demoscope-capture")
  .action(
    async (
      stepfile: string,
      opts: {
        output: string;
        format: string;
        fps: string;
        width?: string;
        headed?: boolean;
        captureDir: string;
      }
    ) => {
      const format = opts.format as "mp4" | "gif";
      if (format !== "mp4" && format !== "gif") {
        console.error("Format must be mp4 or gif");
        process.exit(1);
      }

      const fps = parseInt(opts.fps, 10);

      try {
        console.log("Step 1/2: Capturing frames...");
        await run(stepfile, opts.captureDir, {
          fps,
          headless: !opts.headed,
        });

        console.log("Step 2/2: Rendering video...");
        await renderPipeline(opts.captureDir, {
          outputPath: opts.output,
          format,
          fps,
          width: opts.width ? parseInt(opts.width, 10) : undefined,
        });

        console.log(`Done! Output: ${opts.output}`);
      } catch (err) {
        console.error("Demo failed:", (err as Error).message);
        process.exit(1);
      }
    }
  );

program.parse();
