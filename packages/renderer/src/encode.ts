import { spawn } from "node:child_process";

export interface EncodeOptions {
  framesDir: string;
  outputPath: string;
  format: "mp4" | "gif";
  fps: number;
  width?: number;
}

export function encode(options: EncodeOptions): Promise<void> {
  const { framesDir, outputPath, format, fps, width } = options;
  const inputPattern = `${framesDir}/render-%04d.png`;

  const args: string[] =
    format === "mp4"
      ? buildMp4Args(inputPattern, outputPath, fps)
      : buildGifArgs(inputPattern, outputPath, fps, width);

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

function buildMp4Args(input: string, output: string, fps: number): string[] {
  return [
    "-framerate",
    String(fps),
    "-i",
    input,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "fast",
    "-crf",
    "18",
    output,
  ];
}

function buildGifArgs(
  input: string,
  output: string,
  fps: number,
  width?: number
): string[] {
  const scale = width ? `scale=${width}:-1:flags=lanczos,` : "";
  const gifFps = Math.min(fps, 15);
  const filter = `fps=${gifFps},${scale}split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

  return [
    "-framerate",
    String(fps),
    "-i",
    input,
    "-vf",
    filter,
    "-loop",
    "0",
    output,
  ];
}
