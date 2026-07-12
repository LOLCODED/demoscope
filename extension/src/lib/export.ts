import type { RecordedStep } from "./recorder.js";

interface StepFile {
  meta: {
    title: string;
    baseUrl: string;
    viewport: { width: number; height: number };
    defaultWait: number;
  };
  steps: StepAction[];
}

interface StepAction {
  id: string;
  action: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  typeDelay?: number;
  deltaY?: number;
  wait?: number;
  annotation?: string;
}

export function exportStepFile(
  recorded: RecordedStep[],
  title: string
): StepFile {
  const baseUrl =
    recorded.find((s) => s.action === "navigate")?.url ||
    window.location.origin;
  const origin = new URL(baseUrl).origin;

  const steps: StepAction[] = recorded.map((step) => {
    switch (step.action) {
      case "navigate": {
        // Use relative URL if same origin
        const url = step.url!;
        let relativeUrl = url;
        try {
          const parsed = new URL(url);
          if (parsed.origin === origin) {
            relativeUrl = parsed.pathname + parsed.search + parsed.hash;
          }
        } catch {
          // keep as-is
        }
        return {
          id: step.id,
          action: "navigate",
          url: relativeUrl,
          wait: 1000,
          annotation: step.label || undefined,
        };
      }

      case "click":
        return {
          id: step.id,
          action: "click",
          selector: step.selector!,
          annotation: step.label ? `Click "${step.label}"` : undefined,
        };

      case "type":
        return {
          id: step.id,
          action: "type",
          selector: step.selector!,
          text: step.text!,
          typeDelay: 80,
        };

      case "scroll":
        return {
          id: step.id,
          action: "scroll",
          selector: step.scrollSelector,
          deltaY: step.deltaY!,
        };

      case "keypress":
        return {
          id: step.id,
          action: "keypress",
          key: step.key!,
          selector: step.selector,
          annotation: `Press ${step.key}`,
        };

      default:
        return { id: step.id, action: step.action };
    }
  });

  return {
    meta: {
      title,
      baseUrl: origin,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      defaultWait: 500,
    },
    steps,
  };
}

export function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
