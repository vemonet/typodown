import { expect, test } from "vite-plus/test";
import { parseDirectiveOpening } from "../src/live-preview.ts";

test("parses supported directive containers", () => {
  expect(parseDirectiveOpening(":::note")).toEqual({
    kind: "note",
    alertKind: "note",
    label: "Note",
  });
  expect(parseDirectiveOpening("  :::info  ")).toEqual({
    kind: "info",
    alertKind: "note",
    label: "Note",
  });
  expect(parseDirectiveOpening(":::danger")).toEqual({
    kind: "danger",
    alertKind: "caution",
    label: "Caution",
  });
});

test("parses plain and bracketed directive labels", () => {
  expect(parseDirectiveOpening(":::tip Custom label")?.label).toBe("Custom label");
  expect(parseDirectiveOpening(":::warning[Read this first]")?.label).toBe("Read this first");
});

test("rejects closing and unknown directives", () => {
  expect(parseDirectiveOpening(":::")).toBeNull();
  expect(parseDirectiveOpening(":::details")).toBeNull();
});
