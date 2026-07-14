<script lang="ts">
  import {
    buildCaptureZip,
    buildVideoBundle,
    encodeRecording,
    slugify,
    type OutputFormat,
  } from "@demoscope/browser-kit";
  import { getStore } from "../context.js";

  const store = getStore();
  const caps = store.capabilities;

  // A recording with manifest frames carries cinematics metadata worth keeping,
  // so its "source" download is a bundle (webm + manifest) the editor can
  // reload; a bare imported video just downloads the raw webm.
  const hasMetadata = $derived(store.recording.manifest.frames.length > 0);
  const images = $derived(store.recording.images ?? []);

  let format = $state<OutputFormat>(
    caps.canEncodeMp4 ? "mp4" : caps.canEncodeWebm ? "webm" : "gif"
  );
  let busy = $state(false);
  let progress = $state(0);
  let progressLabel = $state("");
  let resultUrl = $state<string | null>(null);
  let resultFormat = $state<OutputFormat>("gif");

  const downloadName = $derived(
    `${slugify(store.recording.title) || "demo"}.${resultFormat}`
  );

  async function generate(): Promise<void> {
    busy = true;
    progress = 0;
    progressLabel = "Preparing…";
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    try {
      const blob = await encodeRecording({
        source: store.recording.source,
        dims: store.recording.dims,
        fps: store.recording.fps,
        frames: store.sampledFrames(),
        keyOf: store.recording.keyOf,
        format,
        onProgress: (fraction, label) => {
          progress = fraction;
          progressLabel = label;
        },
      });
      resultUrl = URL.createObjectURL(blob);
      resultFormat = format;
    } catch (error) {
      progressLabel = `Failed: ${(error as Error)?.message ?? error}`;
    } finally {
      busy = false;
    }
  }

  function saveBlob(blob: Blob, filename: string): void {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }

  async function downloadSource(): Promise<void> {
    const blob = store.recording.videoBlob;
    if (!blob) return;
    const name = slugify(store.recording.title) || "demo";
    if (hasMetadata) {
      const webm = new Uint8Array(await blob.arrayBuffer());
      const bytes = buildVideoBundle(store.recording.manifest, webm);
      saveBlob(new Blob([bytes as BlobPart], { type: "application/zip" }), `${name}-bundle.zip`);
    } else {
      saveBlob(blob, `${name}.webm`);
    }
  }

  function downloadCaptureZip(): void {
    const name = slugify(store.recording.title) || "demo";
    const bytes = buildCaptureZip(store.recording.manifest, images);
    saveBlob(
      new Blob([bytes as BlobPart], { type: "application/zip" }),
      `${name}-capture.zip`
    );
  }

  function setCursorHighlight(on: boolean): void {
    store.commit((m) => {
      m.cursorHighlight = on || undefined;
    });
  }
</script>

<div class="ds-export">
  <h3>Export</h3>
  <div class="ds-export-row">
    <select bind:value={format} disabled={busy} aria-label="Export format">
      {#if caps.canEncodeMp4}
        <option value="mp4">MP4 (H.264)</option>
      {/if}
      {#if caps.canEncodeWebm}
        <option value="webm">WebM (VP9)</option>
      {/if}
      {#if caps.canEncodeGif}
        <option value="gif">GIF</option>
      {/if}
    </select>
    <button class="ds-btn-primary" onclick={generate} disabled={busy}>
      {busy ? "Rendering…" : "Generate"}
    </button>
  </div>

  <label class="ds-field-check">
    <input
      type="checkbox"
      checked={store.model.cursorHighlight ?? false}
      onchange={(e) => setCursorHighlight(e.currentTarget.checked)}
    />
    Highlight cursor
  </label>

  {#if caps.canDownloadRawWebm}
    <button class="ds-btn-ghost" onclick={downloadSource} disabled={busy}>
      {hasMetadata ? "Download bundle (.zip)" : "Download source .webm"}
    </button>
  {:else if images.length}
    <button class="ds-btn-ghost" onclick={downloadCaptureZip} disabled={busy}>
      Download .zip (for CLI)
    </button>
  {/if}

  {#if busy}
    <div class="ds-progress">
      <div class="ds-progress-bar" style="width:{Math.round(progress * 100)}%"></div>
    </div>
    <p class="ds-progress-label">{progressLabel}</p>
  {/if}

  {#if resultUrl}
    <div class="ds-result">
      {#if resultFormat === "mp4" || resultFormat === "webm"}
        <video src={resultUrl} controls autoplay loop muted></video>
      {:else}
        <img src={resultUrl} alt="Rendered preview" />
      {/if}
      <a class="ds-btn-primary" href={resultUrl} download={downloadName}
        >Download {resultFormat.toUpperCase()}</a
      >
    </div>
  {/if}
</div>
