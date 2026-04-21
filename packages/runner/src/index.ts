import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { type StepFile } from "@demoscope/schema";
import { runSteps, type RunOptions } from "./player.js";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export { runSteps, type RunOptions } from "./player.js";

export async function loadStepFile(filePath: string): Promise<StepFile> {
  const raw = await readFile(filePath, "utf-8");

  let data: unknown;
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    data = yaml.load(raw);
  } else {
    data = JSON.parse(raw);
  }

  // Validate against schema
  const schemaPath = require.resolve("@demoscope/schema/steps.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf-8"));
  const { default: Ajv } = await import("ajv") as unknown as { default: { new(): { compile(schema: unknown): { (data: unknown): boolean; errors?: Array<{ instancePath: string; message?: string }> | null } } } };
  const ajv = new Ajv();
  const validate = ajv.compile(schema);

  if (!validate(data)) {
    const errors = validate.errors
      ?.map((e) => `${e.instancePath} ${e.message}`)
      .join("\n");
    throw new Error(`Invalid step file:\n${errors}`);
  }

  // Resolve relative URLs against baseUrl
  const stepFile = data as StepFile;
  for (const step of stepFile.steps) {
    if (step.action === "navigate" && !step.url.startsWith("http")) {
      step.url = new URL(step.url, stepFile.meta.baseUrl).href;
    }
  }

  return stepFile;
}

export async function run(
  stepFilePath: string,
  outputDir: string,
  options?: Partial<RunOptions>
): Promise<string> {
  const stepFile = await loadStepFile(stepFilePath);

  await mkdir(outputDir, { recursive: true });

  const manifest = await runSteps(stepFile, {
    outputDir,
    ...options,
  });

  const manifestPath = join(outputDir, "capture-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(
    `Captured ${manifest.frames.length} frames to ${outputDir}/frames/`
  );
  console.log(`Manifest written to ${manifestPath}`);

  return manifestPath;
}
