/**
 * Snapshot-based undo/redo. The editor model is plain JSON, so a structured
 * clone per commit is cheap and lets every operation be undoable without each
 * one having to describe its own inverse.
 *
 * Two entry points:
 *  - {@link History.commit} for discrete operations (add zoom, split, delete).
 *  - {@link History.begin}/{@link History.update}/{@link History.end} for
 *    continuous interactions (dragging a segment, sliding zoom strength) so the
 *    whole gesture collapses into a single undo step.
 */
export type Draft<T> = (value: T) => void;

export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private snapshot: T | null = null;

  constructor(
    private value: T,
    // Wrap structuredClone rather than passing it directly: called as
    // `this.clone(x)` the bare native throws "Illegal invocation" in browsers.
    private readonly clone: (value: T) => T = (value) => structuredClone(value),
    private readonly limit = 100
  ) {}

  get present(): T {
    return this.value;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private record(previous: T): void {
    this.undoStack.push(previous);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Apply a discrete, individually-undoable mutation. */
  commit(mutate: Draft<T>): T {
    const previous = this.value;
    const next = this.clone(previous);
    mutate(next);
    this.record(previous);
    this.value = next;
    return this.value;
  }

  /** Snapshot the pre-gesture state; pairs with {@link end}. */
  begin(): void {
    this.snapshot ??= this.clone(this.value);
  }

  /** Mutate the live value without recording history (mid-gesture). */
  update(mutate: Draft<T>): T {
    const next = this.clone(this.value);
    mutate(next);
    this.value = next;
    return this.value;
  }

  /** Close a gesture, recording one undo step if anything actually changed. */
  end(): void {
    if (this.snapshot === null) return;
    const changed =
      JSON.stringify(this.snapshot) !== JSON.stringify(this.value);
    if (changed) this.record(this.snapshot);
    this.snapshot = null;
  }

  undo(): T | null {
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push(this.value);
    this.value = previous;
    return this.value;
  }

  redo(): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(this.value);
    this.value = next;
    return this.value;
  }

  /** Replace the value and clear all history (e.g. loading a new recording). */
  reset(value: T): void {
    this.value = value;
    this.undoStack = [];
    this.redoStack = [];
    this.snapshot = null;
  }
}
