import { describe, expect, it } from "vitest";
import {
  actionTitle,
  documentMarkdown,
  documentPrintHtml,
  escapeHtml,
  type DocumentStep,
} from "./document.js";

const steps: DocumentStep[] = [
  {
    id: "a",
    title: "Open page",
    description: "Land on the app",
    image: "data:x",
  },
  { id: "b", title: "Click <Save>", description: "", image: "data:y" },
];

describe("actionTitle", () => {
  it("labels navigations and indexes other actions", () => {
    expect(actionTitle("navigate", 1)).toBe("Open page");
    expect(actionTitle("click", 3)).toBe("click (3)");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"
    );
  });
});

describe("documentMarkdown", () => {
  it("numbers steps and references bundled image paths", () => {
    const md = documentMarkdown("My demo", steps);
    expect(md).toContain("# My demo");
    expect(md).toContain("## Step 1 — Open page");
    expect(md).toContain("![Open page](steps/step-1.png)");
    expect(md).toContain("![Click <Save>](steps/step-2.png)");
  });
});

describe("documentPrintHtml", () => {
  it("inlines images and escapes user text", () => {
    const html = documentPrintHtml("Demo", steps);
    expect(html).toContain(`<img src="data:x"`);
    expect(html).toContain("Click &lt;Save&gt;"); // escaped title
    expect(html).not.toContain("<Save>"); // raw angle brackets never leak
  });
});
