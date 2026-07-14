import {
  cursorPlacement,
  cursorSvg,
  extractRect,
  cursorInFrame,
  DEFAULT_CURSOR_SIZE,
  type CompositedFrame,
  type CursorShape,
} from "@demoscope/timeline";

export interface CompositorOptions {
  /** Source screenshot width in pixels (already device-scaled). */
  sourceWidth: number;
  /** Source screenshot height in pixels. */
  sourceHeight: number;
  /** Capture-only pixels above the page viewport. */
  sourceTop?: number;
  /** Ratio of source pixels to viewport CSS pixels (e.g. 2 on retina). */
  scale: number;
  /** Output (and canvas) dimensions — must be even for H.264. */
  outputWidth: number;
  outputHeight: number;
  cursorSize?: number;
  clickCursor?: CursorShape;
  showAnnotations?: boolean;
}

/** Load SVG markup into a drawable image via the page's image decoder. */
function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

/**
 * Composites render frames onto a canvas: crops + scales the zoom region, then
 * overlays the cursor and annotation. Mirrors the sharp pipeline
 * (`renderSingleFrame`) so browser output matches the CLI, reusing the same
 * placement/SVG math from `@demoscope/timeline`.
 */
export class CanvasCompositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: Required<CompositorOptions>;
  private cursorImages: Record<CursorShape, HTMLImageElement> | null = null;

  constructor(options: CompositorOptions) {
    this.opts = {
      sourceTop: 0,
      cursorSize: DEFAULT_CURSOR_SIZE,
      clickCursor: "arrow",
      showAnnotations: true,
      ...options,
    };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.opts.outputWidth;
    this.canvas.height = this.opts.outputHeight;
    this.ctx = this.canvas.getContext("2d")!;
  }

  /** Pre-rasterize the cursor glyphs once so per-frame drawing is synchronous. */
  async init(): Promise<void> {
    const [arrow, pointer] = await Promise.all([
      svgToImage(cursorSvg("arrow", this.opts.cursorSize)),
      svgToImage(cursorSvg("pointer", this.opts.cursorSize)),
    ]);
    this.cursorImages = { arrow, pointer };
  }

  async drawFrame(
    frame: CompositedFrame,
    source: CanvasImageSource
  ): Promise<void> {
    const {
      scale,
      sourceWidth,
      sourceHeight,
      sourceTop,
      outputWidth,
      outputHeight,
    } = this.opts;
    const { zoomRect } = frame;

    // Scale the zoom rect to the high-res screenshot, clamped to bounds.
    // Shared with the sharp pipeline so both crop identically.
    const crop = extractRect(zoomRect, scale, sourceWidth, sourceHeight);

    // A single drawImage does crop + resize-to-fill in one step.
    this.ctx.drawImage(
      source,
      crop.left,
      crop.top + sourceTop,
      crop.width,
      crop.height,
      0,
      0,
      outputWidth,
      outputHeight
    );

    this.drawCursor(frame);
    if (this.opts.showAnnotations && frame.annotation) {
      this.drawAnnotation(frame.annotation);
    }
  }

  private drawCursor(frame: CompositedFrame): void {
    if (!this.cursorImages) return;
    if (frame.cursorX === undefined || frame.cursorY === undefined) return;
    const { zoomRect } = frame;
    const rel = cursorInFrame(
      frame.cursorX,
      frame.cursorY,
      zoomRect,
      this.opts.outputWidth,
      this.opts.outputHeight
    );
    if (frame.cursorHighlight) this.drawHighlight(rel.x, rel.y, frame.isClick);
    const shape: CursorShape =
      frame.isClick && this.opts.clickCursor === "pointer"
        ? "pointer"
        : "arrow";
    const placement = cursorPlacement(
      rel.x,
      rel.y,
      shape,
      this.opts.cursorSize
    );
    this.ctx.drawImage(this.cursorImages[shape], placement.left, placement.top);
  }

  /** Soft yellow circle behind the glyph so the pointer is easy to spot. */
  private drawHighlight(x: number, y: number, isClick: boolean): void {
    const { ctx } = this;
    const radius = this.opts.cursorSize * (isClick ? 1.3 : 1.05);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isClick
      ? "rgba(255, 213, 0, 0.5)"
      : "rgba(255, 213, 0, 0.35)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 193, 7, 0.65)";
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw the caption directly with the 2D text API — synchronous, so it lands
   * in the same tick as the frame it belongs to. (An async SVG-image draw
   * raced the playing <video>'s repaint and dropped the caption in preview.)
   */
  private drawAnnotation(text: string): void {
    const { ctx } = this;
    const { outputWidth: w, outputHeight: h } = this.opts;
    const fontSize = Math.max(14, Math.round(w / 60));
    const paddingX = fontSize;
    const paddingY = Math.round(fontSize * 0.6);

    ctx.save();
    ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const maxBoxWidth = w - 40;
    const boxWidth = Math.min(
      ctx.measureText(text).width + paddingX * 2,
      maxBoxWidth
    );
    const boxHeight = fontSize + paddingY * 2;
    const left = (w - boxWidth) / 2;
    const top = h - boxHeight - 20;

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.beginPath();
    ctx.roundRect(left, top, boxWidth, boxHeight, 6);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.fillText(text, w / 2, top + boxHeight / 2, boxWidth - paddingX);
    ctx.restore();
  }
}
