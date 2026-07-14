<script lang="ts">
  import { onMount } from "svelte";
  import {
    dataUrlToBytes,
    loadEditDoc,
    saveWorkingEdit,
    slugify,
    type LoadedRecording,
  } from "@demoscope/browser-kit";
  import { strToU8, zipSync } from "fflate";
  import {
    actionTitle,
    documentMarkdown,
    documentPrintHtml,
    type DocumentStep,
  } from "../core/document.js";
  import type { EditorController } from "../editor-controller.js";
  import VersionsPanel from "./VersionsPanel.svelte";

  const {
    recording,
    onController,
  }: {
    recording: LoadedRecording;
    onController?: (c: EditorController) => void;
  } = $props();

  let steps = $state<DocumentStep[]>([]);
  let ready = $state(false);
  /** Freshly-built steps, kept pristine as the "Original" baseline. */
  let autoSteps = $state<DocumentStep[]>([]);
  let previewing = $state(false);
  let previewBackup: DocumentStep[] | null = null;
  // JSON of the last saved steps; drives the unsaved-changes guard.
  let savedBaseline = $state("");

  const cloneSteps = (list: DocumentStep[]) => list.map((step) => ({ ...step }));
  const stepsJson = () => JSON.stringify($state.snapshot(steps));

  const isDirty = () =>
    ready && !previewing && !!recording.id && stepsJson() !== savedBaseline;

  async function persist(): Promise<void> {
    if (!recording.id) return;
    const snapshot = $state.snapshot(steps) as DocumentStep[];
    await saveWorkingEdit(recording.id, "document", snapshot);
    savedBaseline = JSON.stringify(snapshot);
  }

  onMount(() => onController?.({ isDirty, save: persist }));

  $effect(() => {
    let cancelled = false;
    void init(() => cancelled);
    return () => {
      cancelled = true;
    };
  });

  async function init(isCancelled: () => boolean): Promise<void> {
    const built = await buildSteps();
    const doc = recording.id
      ? await loadEditDoc<DocumentStep[]>(recording.id, "document")
      : undefined;
    if (isCancelled()) return;
    autoSteps = built;
    steps = doc ? doc.working : cloneSteps(built);
    savedBaseline = stepsJson();
    ready = true;
  }

  function previewVersion(model: DocumentStep[]): void {
    previewBackup ??= $state.snapshot(steps) as DocumentStep[];
    previewing = true;
    steps = cloneSteps(model);
  }

  function exitPreview(): void {
    if (!previewBackup) return;
    steps = previewBackup;
    previewBackup = null;
    previewing = false;
  }

  function restoreVersion(model: DocumentStep[]): void {
    previewBackup = null;
    previewing = false;
    steps = cloneSteps(model);
  }

  /** Reuse the original screenshot if present, else rasterize the frame source. */
  async function stepImage(timeMs: number, index: number): Promise<string> {
    if (recording.images?.[index]) return recording.images[index];
    const bitmap = await recording.source.get(timeMs);
    const { outputWidth, outputHeight, sourceTop, sourceContentHeight } =
      recording.dims;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(960, recording.source.width);
    canvas.height = Math.round(canvas.width * (outputHeight / outputWidth));
    canvas
      .getContext("2d")!
      .drawImage(
        bitmap,
        0,
        sourceTop,
        recording.source.width,
        sourceContentHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );
    return canvas.toDataURL("image/png");
  }

  async function buildSteps(): Promise<DocumentStep[]> {
    const frames = recording.manifest.frames;
    const built: DocumentStep[] = [];
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      const title =
        frame.annotation ?? actionTitle(frame.action ?? "capture", index + 1);
      built.push({
        id: crypto.randomUUID(),
        title,
        description: "",
        image: await stepImage(frame.videoTimeMs ?? 0, index),
      });
    }
    return built;
  }

  function move(index: number, offset: number): void {
    const target = index + offset;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    steps = next;
  }

  function remove(index: number): void {
    steps = steps.filter((_, position) => position !== index);
  }

  async function addStep(): Promise<void> {
    const lastTime = recording.manifest.frames.at(-1)?.videoTimeMs ?? 0;
    const image = await stepImage(lastTime, steps.length);
    steps = [
      ...steps,
      { id: crypto.randomUUID(), title: "New step", description: "", image },
    ];
  }

  function copyMarkdown(): void {
    void navigator.clipboard.writeText(
      documentMarkdown(recording.title, steps)
    );
  }

  function downloadBundle(): void {
    const files: Record<string, Uint8Array> = {
      "README.md": strToU8(documentMarkdown(recording.title, steps)),
    };
    steps.forEach((step, index) => {
      files[`steps/step-${index + 1}.png`] = dataUrlToBytes(step.image);
    });
    const name = slugify(recording.title) || "steps";
    saveBlob(
      new Blob([zipSync(files, { level: 1 }) as BlobPart], {
        type: "application/zip",
      }),
      `${name}-document.zip`
    );
  }

  function print(): void {
    const page = window.open("", "_blank");
    if (!page) return;
    page.document.write(documentPrintHtml(recording.title, steps));
    page.document.close();
    void waitForImages(page.document).then(() => {
      page.focus();
      page.print();
    });
  }

  async function waitForImages(doc: Document): Promise<void> {
    await Promise.all(
      Array.from(doc.images).map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            })
      )
    );
  }

  function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
</script>

<div class="ds-document">
  {#if !ready}
    <p class="ds-app-msg">Building steps…</p>
  {:else}
    <div class="ds-document-steps">
      {#each steps as step, index (step.id)}
        <article class="ds-document-step">
          <span class="ds-step-number">Step {index + 1}</span>
          <input class="ds-step-title" bind:value={step.title} placeholder="Step title" />
          <img src={step.image} alt={`Step ${index + 1}`} />
          <div class="ds-step-fields">
            <textarea
              bind:value={step.description}
              placeholder="Optional explanation"
            ></textarea>
            <div class="ds-step-actions">
              <button class="ds-btn" onclick={() => move(index, -1)}>↑</button>
              <button class="ds-btn" onclick={() => move(index, 1)}>↓</button>
              <button class="ds-btn" onclick={() => remove(index)}>Remove</button>
            </div>
          </div>
        </article>
      {/each}
    </div>
    <div class="ds-document-actions">
      <button class="ds-btn" onclick={() => void addStep()}>+ Add step</button>
      <button class="ds-btn-primary" onclick={copyMarkdown}>Copy Markdown</button>
      <button class="ds-btn" onclick={downloadBundle}>Download Markdown + images</button>
      <button class="ds-btn-primary" onclick={print}>Print / Save PDF</button>
    </div>
    {#if recording.id}
      <VersionsPanel
        recordingId={recording.id}
        kind="document"
        baseline={autoSteps}
        getCurrent={() => $state.snapshot(steps) as DocumentStep[]}
        onPreview={previewVersion}
        onExitPreview={exitPreview}
        onRestore={(model) => {
          restoreVersion(model);
          void persist();
        }}
        onSaved={persist}
      />
    {/if}
  {/if}
</div>
