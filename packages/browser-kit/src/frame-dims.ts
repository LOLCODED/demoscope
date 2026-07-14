import type { FrameSource } from "./frame-source.js";

/** Output geometry derived from a source: even dimensions, letterbox-trimmed. */
export interface OutputDims {
  /** Ratio of source pixels to viewport CSS pixels (e.g. 2 on retina). */
  scale: number;
  /** Capture-only pixels above the page viewport (letterbox strip). */
  sourceTop: number;
  /** Usable source height below the strip. */
  sourceContentHeight: number;
  /** Output width, even, capped at 1920. */
  outputWidth: number;
  /** Output height, even. */
  outputHeight: number;
}

const toEven = (n: number): number => {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
};

export async function computeOutputDims(
  source: FrameSource,
  viewportWidth: number
): Promise<OutputDims> {
  const scale = source.width / viewportWidth;
  const bounds = await contentBounds(source);
  const outputWidth = toEven(Math.min(source.width, 1920));
  const sourceTop = bounds.top;
  const sourceContentHeight = Math.min(
    bounds.height,
    Math.max(1, source.height - sourceTop)
  );
  const outputHeight = toEven(
    outputWidth * (sourceContentHeight / source.width)
  );
  return { scale, sourceTop, sourceContentHeight, outputWidth, outputHeight };
}

/**
 * Tab capture occasionally includes a black chrome/letterbox strip around the
 * page. Detect only sustained, near-black edge rows so the compositor exports
 * the actual page pixels instead of encoding the strip into every frame.
 */
export async function contentBounds(
  source: FrameSource
): Promise<{ top: number; height: number }> {
  const image = await source.get(0);
  const sampleWidth = 96;
  const sampleHeight = Math.min(source.height, 2160);
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const isBlackRow = (row: number) => {
    let dark = 0;
    for (let column = 0; column < sampleWidth; column++) {
      const offset = (row * sampleWidth + column) * 4;
      if (
        pixels[offset] < 14 &&
        pixels[offset + 1] < 14 &&
        pixels[offset + 2] < 14
      )
        dark++;
    }
    return dark / sampleWidth > 0.97;
  };
  const edgeRows = (fromStart: boolean) => {
    let count = 0;
    for (
      let row = fromStart ? 0 : sampleHeight - 1;
      row >= 0 && row < sampleHeight;
      row += fromStart ? 1 : -1
    ) {
      if (!isBlackRow(row)) break;
      count++;
    }
    return (count / sampleHeight) * source.height;
  };
  const top = edgeRows(true);
  const bottom = edgeRows(false);
  const minimumBarHeight = Math.max(10, source.height * 0.01);
  const cropTop = top >= minimumBarHeight ? Math.round(top) : 0;
  const cropBottom = bottom >= minimumBarHeight ? Math.round(bottom) : 0;
  const height = source.height - cropTop - cropBottom;
  return height > source.height * 0.5
    ? { top: cropTop, height }
    : { top: 0, height: source.height };
}
