export interface DocumentStep {
  id: string;
  title: string;
  description: string;
  /** Data URL of the step screenshot. */
  image: string;
}

/** A readable default heading for a captured interaction. */
export function actionTitle(action: string, index: number): string {
  return action === "navigate" ? "Open page" : `${action} (${index})`;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!
  );
}

/** Markdown body; images reference the `steps/step-N.png` files in the bundle. */
export function documentMarkdown(title: string, steps: DocumentStep[]): string {
  return [
    `# ${title}`,
    "",
    ...steps.flatMap((step, index) => [
      `## Step ${index + 1} — ${step.title}`,
      "",
      step.description,
      "",
      `![${step.title}](steps/step-${index + 1}.png)`,
      "",
    ]),
  ].join("\n");
}

/** Self-contained HTML for the print / save-as-PDF window (inline images). */
export function documentPrintHtml(
  title: string,
  steps: DocumentStep[]
): string {
  const sections = steps
    .map(
      (step, index) => `<section class="step"><span>STEP ${index + 1}</span>
        <h2>${escapeHtml(step.title)}</h2>
        <img src="${step.image}" alt="${escapeHtml(step.title)}">
        ${step.description ? `<p>${escapeHtml(step.description)}</p>` : ""}</section>`
    )
    .join("\n");
  return `<!doctype html><title>${escapeHtml(title)}</title><style>
    body { font: 14px system-ui; max-width: 860px; margin: 36px auto; color: #111; }
    .step { display: grid; gap: 14px; padding: 18px; margin: 18px 0; border: 1px solid #d1d5db;
      border-radius: 10px; break-inside: avoid-page; page-break-inside: avoid; }
    img { width: min(100%, 640px); max-height: 400px; object-fit: contain; background: #111827; border-radius: 6px; }
    span { font-size: 11px; font-weight: 700; color: #2563eb; }
    h2 { margin: 0; } p { line-height: 1.5; margin-bottom: 0; }
    @media print {
      @page { margin: 22mm 16mm 18mm; }
      body { margin: 0; }
      .step, .step img { break-inside: avoid-page; page-break-inside: avoid; }
      .step img { display: block; }
    }
  </style><h1>${escapeHtml(title)}</h1>${sections}`;
}
