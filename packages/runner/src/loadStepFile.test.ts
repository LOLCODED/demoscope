import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStepFile } from "./index.js";

const examplesDir = fileURLToPath(
  new URL("../../../examples/", import.meta.url)
);

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "demoscope-test-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeTemp(name: string, contents: string): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, contents);
  return path;
}

describe("loadStepFile", () => {
  it("parses the bundled JSON example", async () => {
    const stepFile = await loadStepFile(
      join(examplesDir, "example-search.json")
    );
    expect(stepFile.meta.baseUrl).toBe("https://www.wikipedia.org");
    expect(stepFile.steps).toHaveLength(4);
    expect(stepFile.steps[0].action).toBe("navigate");
  });

  it("parses YAML and JSON to the same structure", async () => {
    const fromJson = await loadStepFile(
      join(examplesDir, "example-search.json")
    );
    const fromYaml = await loadStepFile(
      join(examplesDir, "example-search.yaml")
    );
    expect(fromYaml.steps).toEqual(fromJson.steps);
  });

  it("resolves relative navigate URLs against baseUrl", async () => {
    const path = await writeTemp(
      "relative.json",
      JSON.stringify({
        meta: {
          baseUrl: "http://localhost:3000",
          viewport: { width: 800, height: 600 },
        },
        steps: [{ action: "navigate", url: "/dashboard" }],
      })
    );
    const stepFile = await loadStepFile(path);
    const step = stepFile.steps[0];
    expect(step.action === "navigate" && step.url).toBe(
      "http://localhost:3000/dashboard"
    );
  });

  it("leaves absolute navigate URLs untouched", async () => {
    const path = await writeTemp(
      "absolute.json",
      JSON.stringify({
        meta: {
          baseUrl: "http://localhost:3000",
          viewport: { width: 800, height: 600 },
        },
        steps: [{ action: "navigate", url: "https://example.com/page" }],
      })
    );
    const stepFile = await loadStepFile(path);
    const step = stepFile.steps[0];
    expect(step.action === "navigate" && step.url).toBe(
      "https://example.com/page"
    );
  });

  it("rejects a step file that violates the schema", async () => {
    const path = await writeTemp(
      "invalid.json",
      JSON.stringify({
        meta: { viewport: { width: 800, height: 600 } }, // missing baseUrl
        steps: [{ action: "click", selector: "#x" }],
      })
    );
    await expect(loadStepFile(path)).rejects.toThrow(/Invalid step file/);
  });

  it("rejects an unknown action", async () => {
    const path = await writeTemp(
      "unknown-action.json",
      JSON.stringify({
        meta: { baseUrl: "http://x", viewport: { width: 800, height: 600 } },
        steps: [{ action: "teleport" }],
      })
    );
    await expect(loadStepFile(path)).rejects.toThrow(/Invalid step file/);
  });
});
