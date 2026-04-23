import { generateSelector, getElementLabel } from "./selector.js";

// Selector generation must never drop a capture event. If it throws for any
// reason, fall back to a tag-only selector so the frame is still recorded —
// a broken selector only hurts replay, but a dropped event is invisible.
function safeSelector(el: Element): string {
  try {
    return generateSelector(el);
  } catch (err) {
    console.warn("selector generation failed, using fallback", err);
    return el.tagName.toLowerCase();
  }
}

export interface RecordedStep {
  id: string;
  action: "navigate" | "click" | "type" | "scroll" | "keypress";
  timestamp: number;
  url?: string;
  selector?: string;
  label?: string;
  text?: string;
  key?: string;
  deltaY?: number;
  scrollSelector?: string;
}

export type InteractionCallback = (event: {
  action: string;
  cursorX: number;
  cursorY: number;
  stepId: string;
  annotation?: string;
  isClick?: boolean;
  typedText?: string;
}) => void;

let steps: RecordedStep[] = [];
let stepCounter = 0;
let recording = false;
let onInteraction: InteractionCallback | null = null;
let pendingType: { selector: string; text: string; stepId: string; label: string } | null = null;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
let scrollAccum = 0;
let scrollTarget: string | null = null;
let lastCursorX = 0;
let lastCursorY = 0;

function nextId(): string {
  return `step-${++stepCounter}`;
}

export function startRecording(callback?: InteractionCallback): void {
  steps = [];
  stepCounter = 0;
  pendingType = null;
  scrollAccum = 0;
  scrollTarget = null;
  recording = true;
  onInteraction = callback ?? null;

  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("scroll", onScroll, true);
  document.addEventListener("mousemove", onMouseMove, true);

  patchHistory();

  // Record the initial page
  const id = nextId();
  steps.push({
    id,
    action: "navigate",
    timestamp: Date.now(),
    url: window.location.href,
  });

  emitCapture({
    action: "navigate",
    cursorX: window.innerWidth / 2,
    cursorY: window.innerHeight / 2,
    stepId: id,
  });
}

export function stopRecording(): RecordedStep[] {
  recording = false;
  flushPendingType();
  flushPendingScroll();

  document.removeEventListener("click", onClickCapture, true);
  document.removeEventListener("keydown", onKeydown, true);
  document.removeEventListener("input", onInput, true);
  document.removeEventListener("scroll", onScroll, true);
  document.removeEventListener("mousemove", onMouseMove, true);

  unpatchHistory();
  onInteraction = null;
  return steps;
}

export function getSteps(): RecordedStep[] {
  return steps;
}

export function isRecording(): boolean {
  return recording;
}

// --- Emit capture event ---

function emitCapture(event: {
  action: string;
  cursorX: number;
  cursorY: number;
  stepId: string;
  annotation?: string;
  isClick?: boolean;
  typedText?: string;
}): void {
  onInteraction?.(event);
  notifyBackground();
}

// --- Mouse tracking ---

function onMouseMove(e: MouseEvent): void {
  lastCursorX = e.clientX;
  lastCursorY = e.clientY;
}

// --- Event handlers ---

function onClickCapture(e: MouseEvent): void {
  if (!recording) return;
  const target = e.target as Element;
  if (!target) return;

  flushPendingType();
  flushPendingScroll();

  const selector = safeSelector(target);
  const label = getElementLabel(target);
  const id = nextId();

  steps.push({
    id,
    action: "click",
    timestamp: Date.now(),
    selector,
    label,
  });

  emitCapture({
    action: "click",
    cursorX: e.clientX,
    cursorY: e.clientY,
    stepId: id,
    annotation: label ? `Click "${label}"` : undefined,
    isClick: true,
  });
}

const ACTION_KEYS = new Set([
  "Enter", "Escape", "Tab",
  "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

function onKeydown(e: KeyboardEvent): void {
  if (!recording) return;
  if (!ACTION_KEYS.has(e.key)) return;

  flushPendingType();

  const target = e.target as Element | null;
  const selector = target ? safeSelector(target) : undefined;
  const id = nextId();

  steps.push({
    id,
    action: "keypress",
    timestamp: Date.now(),
    key: e.key,
    selector,
  });

  emitCapture({
    action: "keypress",
    cursorX: lastCursorX,
    cursorY: lastCursorY,
    stepId: id,
    annotation: `Press ${e.key}`,
  });
}

function onInput(e: Event): void {
  if (!recording) return;
  const target = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target || !("value" in target)) return;

  const selector = safeSelector(target);
  const label = getElementLabel(target);

  if (pendingType && pendingType.selector === selector) {
    pendingType.text = target.value;
  } else {
    flushPendingType();
    pendingType = {
      selector,
      text: target.value,
      stepId: nextId(),
      label,
    };
  }

  notifyBackground();
}

function onScroll(_e: Event): void {
  if (!recording) return;

  const target = document.scrollingElement || document.documentElement;
  const selector = target === document.documentElement ? undefined : safeSelector(target as Element);
  const currentTarget = selector || "__page__";

  if (scrollTarget !== currentTarget) {
    flushPendingScroll();
    scrollTarget = currentTarget;
    scrollAccum = 0;
  }

  const scrollY = (target as Element).scrollTop;
  scrollAccum = scrollY;

  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => flushPendingScroll(), 300);
}

function flushPendingType(): void {
  if (!pendingType) return;
  const step = pendingType;
  pendingType = null;

  steps.push({
    id: step.stepId,
    action: "type",
    timestamp: Date.now(),
    selector: step.selector,
    text: step.text,
    label: step.label,
  });

  emitCapture({
    action: "type",
    cursorX: lastCursorX,
    cursorY: lastCursorY,
    stepId: step.stepId,
    annotation: step.text ? `Type "${step.text}"` : undefined,
    typedText: step.text,
  });
}

function flushPendingScroll(): void {
  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
    scrollTimeout = null;
  }
  if (scrollAccum !== 0 && scrollTarget) {
    const id = nextId();
    steps.push({
      id,
      action: "scroll",
      timestamp: Date.now(),
      deltaY: scrollAccum,
      scrollSelector: scrollTarget === "__page__" ? undefined : scrollTarget,
    });

    emitCapture({
      action: "scroll",
      cursorX: lastCursorX,
      cursorY: lastCursorY,
      stepId: id,
    });

    scrollAccum = 0;
    scrollTarget = null;
  }
}

// --- SPA navigation detection ---

let originalPushState: typeof history.pushState | null = null;
let originalReplaceState: typeof history.replaceState | null = null;

function patchHistory(): void {
  originalPushState = history.pushState.bind(history);
  originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState!(...args);
    onNavigation();
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState!(...args);
    onNavigation();
  };

  window.addEventListener("popstate", onNavigation);
}

function unpatchHistory(): void {
  if (originalPushState) history.pushState = originalPushState;
  if (originalReplaceState) history.replaceState = originalReplaceState;
  originalPushState = null;
  originalReplaceState = null;
  window.removeEventListener("popstate", onNavigation);
}

function onNavigation(): void {
  if (!recording) return;
  flushPendingType();
  flushPendingScroll();

  const id = nextId();
  steps.push({
    id,
    action: "navigate",
    timestamp: Date.now(),
    url: window.location.href,
  });

  emitCapture({
    action: "navigate",
    cursorX: lastCursorX,
    cursorY: lastCursorY,
    stepId: id,
  });
}

// --- Communication ---

function notifyBackground(): void {
  chrome.runtime.sendMessage({ type: "step-added", count: steps.length }).catch(() => {});
}
