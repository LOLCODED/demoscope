import { describe, expect, it } from "vitest";
import {
  withNewVersion,
  withRenamedVersion,
  withWorking,
  withoutVersion,
  type EditDoc,
  type EditVersion,
} from "./recording-store.js";

type Model = { label: string };

const version = (id: string, name: string): EditVersion<Model> => ({
  id,
  name,
  createdAt: 0,
  model: { label: name },
});

describe("edit-doc reducers", () => {
  it("withWorking replaces the working copy but keeps versions", () => {
    const doc: EditDoc<Model> = {
      working: { label: "old" },
      versions: [version("v1", "first")],
    };
    const next = withWorking(doc, { label: "new" });
    expect(next.working).toEqual({ label: "new" });
    expect(next.versions).toBe(doc.versions);
  });

  it("withWorking seeds a fresh doc when none exists", () => {
    expect(withWorking(undefined, { label: "a" })).toEqual({
      working: { label: "a" },
      versions: [],
    });
  });

  it("withNewVersion prepends (newest first) and keeps the working copy", () => {
    const doc: EditDoc<Model> = {
      working: { label: "work" },
      versions: [version("v1", "first")],
    };
    const next = withNewVersion(doc, version("v2", "second"));
    expect(next.versions.map((v) => v.id)).toEqual(["v2", "v1"]);
    expect(next.working).toEqual({ label: "work" });
  });

  it("withNewVersion on an empty doc adopts the version model as working", () => {
    const next = withNewVersion(undefined, version("v1", "only"));
    expect(next.working).toEqual({ label: "only" });
    expect(next.versions).toHaveLength(1);
  });

  it("withoutVersion drops just the matching id", () => {
    const doc: EditDoc<Model> = {
      working: { label: "work" },
      versions: [version("v1", "a"), version("v2", "b")],
    };
    expect(withoutVersion(doc, "v1").versions.map((v) => v.id)).toEqual(["v2"]);
  });

  it("withRenamedVersion renames only the target without mutating input", () => {
    const doc: EditDoc<Model> = {
      working: { label: "work" },
      versions: [version("v1", "a"), version("v2", "b")],
    };
    const next = withRenamedVersion(doc, "v2", "renamed");
    expect(next.versions.map((v) => v.name)).toEqual(["a", "renamed"]);
    expect(doc.versions[1].name).toBe("b");
  });
});
