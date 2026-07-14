import { describe, expect, it } from "vitest";
import { History } from "./history.js";

interface State {
  count: number;
  items: string[];
}

const start = (): State => ({ count: 0, items: [] });

describe("History.commit", () => {
  it("applies a mutation to a clone and leaves the previous value intact", () => {
    const history = new History(start());
    const before = history.present;
    history.commit((s) => (s.count = 5));
    expect(history.present.count).toBe(5);
    expect(before.count).toBe(0); // previous snapshot untouched
    expect(history.canUndo).toBe(true);
  });

  it("undoes and redoes", () => {
    const history = new History(start());
    history.commit((s) => (s.count = 1));
    history.commit((s) => (s.count = 2));
    expect(history.undo()?.count).toBe(1);
    expect(history.undo()?.count).toBe(0);
    expect(history.undo()).toBeNull();
    expect(history.redo()?.count).toBe(1);
    expect(history.redo()?.count).toBe(2);
  });

  it("clears the redo stack on a new commit", () => {
    const history = new History(start());
    history.commit((s) => (s.count = 1));
    history.undo();
    history.commit((s) => (s.count = 9));
    expect(history.canRedo).toBe(false);
    expect(history.present.count).toBe(9);
  });
});

describe("History transient gestures", () => {
  it("collapses many updates into one undo step", () => {
    const history = new History(start());
    history.begin();
    history.update((s) => (s.count = 1));
    history.update((s) => (s.count = 2));
    history.update((s) => (s.count = 3));
    history.end();
    expect(history.present.count).toBe(3);
    expect(history.undo()?.count).toBe(0); // single step back to pre-gesture
  });

  it("records nothing when a gesture makes no change", () => {
    const history = new History(start());
    history.begin();
    history.end();
    expect(history.canUndo).toBe(false);
  });
});

describe("History.reset", () => {
  it("replaces the value and clears history", () => {
    const history = new History(start());
    history.commit((s) => (s.count = 1));
    history.reset({ count: 42, items: ["a"] });
    expect(history.present.count).toBe(42);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
