// --- Step file types ---

export interface StepFileMeta {
  title?: string;
  baseUrl: string;
  viewport: { width: number; height: number };
  defaultWait?: number;
}

export interface ZoomConfig {
  level: number;
  padding?: number;
}

export type StepAction =
  | NavigateStep
  | ClickStep
  | TypeStep
  | ScrollStep
  | WaitStep
  | HoverStep
  | SelectStep
  | KeypressStep;

interface BaseStep {
  id?: string;
  annotation?: string;
  wait?: number;
  zoom?: ZoomConfig;
  highlight?: boolean;
}

export interface NavigateStep extends BaseStep {
  action: "navigate";
  url: string;
}

export interface ClickStep extends BaseStep {
  action: "click";
  selector: string;
}

export interface TypeStep extends BaseStep {
  action: "type";
  selector: string;
  text: string;
  typeDelay?: number;
}

export interface ScrollStep extends BaseStep {
  action: "scroll";
  selector?: string;
  deltaY: number;
}

export interface WaitStep extends BaseStep {
  action: "wait";
  duration: number;
}

export interface HoverStep extends BaseStep {
  action: "hover";
  selector: string;
}

export interface SelectStep extends BaseStep {
  action: "select";
  selector: string;
  value: string;
}

export interface KeypressStep extends BaseStep {
  action: "keypress";
  key: string;
  selector?: string;
}

export interface StepFile {
  meta: StepFileMeta;
  steps: StepAction[];
}

// --- Capture manifest types ---

export interface CapturedFrame {
  path: string;
  index: number;
  timestamp: number;
  cursorX: number;
  cursorY: number;
  stepId?: string;
  action?: string;
  zoom?: {
    level: number;
    padding: number;
    centerX: number;
    centerY: number;
  };
  annotation?: string;
  isClick?: boolean;
  /** Text the user typed for this step — drives the progressive typing animation. */
  typedText?: string;
}

export interface CaptureManifest {
  meta: StepFileMeta;
  fps: number;
  frames: CapturedFrame[];
}

// --- Render config types ---

export interface RenderConfig {
  format: "mp4" | "gif";
  fps: number;
  width?: number;
  outputPath: string;
  zoomTransitionMs?: number;
  cursorSize?: number;
  /** Base hold time per captured step in ms */
  holdMs?: number;
  /** Hold time for steps that display an annotation in ms */
  annotationHoldMs?: number;
  /** Hold time for the very first captured step (intro breathing room) in ms */
  introHoldMs?: number;
  /** Whether to render annotation overlays (default true) */
  showAnnotations?: boolean;
  /** Cursor shape on click frames. "arrow" keeps the pointer consistent;
   * "pointer" swaps in a hand on click. Default "arrow". */
  clickCursor?: "arrow" | "pointer";
}
