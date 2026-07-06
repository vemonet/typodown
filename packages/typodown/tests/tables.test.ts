import { expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { findLenientTables, isDelimRow, splitCells } from "../src/live-preview.ts";

// ---- splitCells ----------------------------------------------------------

test("splitCells splits a plain row", () => {
  expect(splitCells("| a | b | c |")).toEqual(["a", "b", "c"]);
  expect(splitCells("a | b")).toEqual(["a", "b"]);
});

test("splitCells leaves pipes inside backtick code spans alone", () => {
  // The whole `"light" | "dark" | "auto"` is a single code span: the pipes
  // inside it must not split the cell.
  expect(splitCells('| `theme` | `"light" | "dark" | "auto"` | desc |')).toEqual([
    "`theme`",
    '`"light" | "dark" | "auto"`',
    "desc",
  ]);
});

test("splitCells leaves backslash-escaped pipes alone", () => {
  expect(splitCells("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
});

test("splitCells treats an unmatched backtick run as literal", () => {
  // No closing backtick -> the backtick is text, so the pipe after it splits.
  expect(splitCells("| `unmatched | still | here |")).toEqual(["`unmatched", "still", "here"]);
});

test("splitCells handles the user's theme and getClipboardText rows", () => {
  const theme =
    '| `theme` | `"light" | "dark" | "auto"` | `"auto"` | Colour theme. `auto` follows the OS preference. |';
  expect(splitCells(theme)).toHaveLength(4);
  const clip =
    "| `getClipboardText` | `() => string | Promise<string>` | `navigator.clipboard.readText` | Read the clipboard. |";
  expect(splitCells(clip)).toHaveLength(4);
});

// ---- isDelimRow ----------------------------------------------------------

test("isDelimRow accepts dashes with optional alignment colons", () => {
  expect(isDelimRow(splitCells("| --- | --- |"))).toBe(true);
  expect(isDelimRow(splitCells("| :--: | --: | :-- |"))).toBe(true);
  // The user's separator has more cells than the header; it is still a delimiter.
  expect(isDelimRow(splitCells("| --- | --- | --- | --- | --- | --- |"))).toBe(true);
});

test("isDelimRow rejects non-delimiter rows", () => {
  expect(isDelimRow(splitCells("| a | b |"))).toBe(false);
  expect(isDelimRow(splitCells("| --a-- | --- |"))).toBe(false);
  expect(isDelimRow([])).toBe(false);
});

// ---- findLenientTables ---------------------------------------------------

// A table the GFM grammar rejects: the delimiter row has 6 cells while the
// header has 4, and two body rows carry a union type whose `|`s sit inside a
// code span. This is the shape from the bug report.
const lenientTable = [
  "| Option | Type | Default | Description |",
  "| --- | --- | --- | --- | --- | --- |",
  '| `value` | `string` | `""` | Initial markdown content. |',
  '| `theme` | `"light" | "dark" | "auto"` | `"auto"` | Colour theme. |',
  "| `getClipboardText` | `() => string | Promise<string>` | `navigator.clipboard.readText` | Read the clipboard. |",
].join("\n");

// A well-formed GFM table (delimiter matches the header) that Lezer recognises.
const wellFormedTable = [
  "| Option | Type |",
  "| --- | --- |",
  "| `value` | `string` |",
  "| `theme` | `string` |",
].join("\n");

function stateWith(doc: string, caret: number): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(caret) });
}

test("findLenientTables renders a table Lezer rejects (caret elsewhere)", () => {
  const doc = `text\n\n${lenientTable}`;
  const state = stateWith(doc, 0); // caret on "text", outside the table
  const out: { from: number; to: number }[] = [];
  findLenientTables(state, [], out as never);
  expect(out).toHaveLength(1);
  // The widget covers the header through the last body row.
  const tableStart = state.doc.line(3).from;
  expect(out[0]!.from).toBe(tableStart);
  expect(out[0]!.to).toBe(state.doc.line(7).to);
});

test("findLenientTables reveals raw markdown when the caret is in the table", () => {
  const doc = `text\n\n${lenientTable}`;
  const tableStart = stateWith(doc, 0).doc.line(3).from;
  const state = stateWith(doc, tableStart); // caret inside the table
  const out: { from: number; to: number }[] = [];
  findLenientTables(state, [], out as never);
  expect(out).toHaveLength(0);
});

test("findLenientTables skips ranges Lezer already claimed (no double render)", () => {
  const doc = `text\n\n${wellFormedTable}`;
  const state = stateWith(doc, 0);
  const tableStart = state.doc.line(3).from;
  const tableEnd = state.doc.line(6).to;
  // Simulate Lezer having recognised the table.
  const out: { from: number; to: number }[] = [];
  findLenientTables(state, [[tableStart, tableEnd]], out as never);
  expect(out).toHaveLength(0);
});

test("findLenientTables does not fire inside a claimed code block", () => {
  // Table-looking lines wrapped in a fenced code block.
  const doc = "```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n";
  const state = stateWith(doc, 0);
  // Lezer would claim the whole fenced block.
  const fenceStart = 0;
  const fenceEnd = state.doc.length;
  const out: { from: number; to: number }[] = [];
  findLenientTables(state, [[fenceStart, fenceEnd]], out as never);
  expect(out).toHaveLength(0);
});
