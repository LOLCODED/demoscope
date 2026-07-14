import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildVideoBundle, type CaptureManifest } from "./capture-bundle.js";

describe("buildVideoBundle", () => {
  it("packs the manifest and webm into one zip", () => {
    const manifest = {
      meta: { baseUrl: "", viewport: { width: 320, height: 180 } },
      fps: 30,
      frames: [],
      video: { mime: "video/webm", durationMs: 1000 },
    } satisfies CaptureManifest;
    const webm = new Uint8Array([1, 2, 3, 4, 5]);

    const entries = unzipSync(buildVideoBundle(manifest, webm));
    expect(
      JSON.parse(strFromU8(entries["capture-manifest.json"]))
    ).toMatchObject({
      fps: 30,
      video: { durationMs: 1000 },
    });
    expect(Array.from(entries["recording.webm"])).toEqual([1, 2, 3, 4, 5]);
  });
});
