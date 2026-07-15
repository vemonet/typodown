// @vitest-environment jsdom
// renderCellHTML sanitizes via DOMPurify, which needs a DOM.
import { expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  addTableColumn,
  addTableRow,
  cellsInRange,
  cellWriteChange,
  deleteTable,
  escapeCellPipes,
  findLenientTables,
  isDelimRow,
  renderCellHTML,
  splitCells,
} from "../src/live-preview.ts";

// Apply a single-line change spec to a line string (offsets are absolute; the
// line here starts at 0).
function applyChange(line: string, change: { from: number; to: number; insert: string }): string {
  return line.slice(0, change.from) + change.insert + line.slice(change.to);
}

// ---- cellWriteChange -------------------------------------------------------

test("cellWriteChange replaces an existing cell in place", () => {
  const line = "| a | b | c |";
  const change = cellWriteChange(line, 0, 1, "X");
  expect(applyChange(line, change)).toBe("| a |X| c |");
});

test("cellWriteChange pads a short row so a trailing edit persists", () => {
  // A 2-cell row in a 3-column table: writing column 2 must extend the row
  // rather than drop the edit (the README Android-row bug).
  const line = "| **Android app** | Open `.md` files |";
  const change = cellWriteChange(line, 0, 2, "[Download](https://example.com)");
  expect(applyChange(line, change)).toBe(
    "| **Android app** | Open `.md` files | [Download](https://example.com) |",
  );
});

test("cellWriteChange pads multiple missing columns with empties", () => {
  const line = "| a |";
  const change = cellWriteChange(line, 0, 2, "z");
  expect(applyChange(line, change)).toBe("| a |  | z |");
});

test("cellWriteChange escapes free pipes in the written value", () => {
  const line = "| a | b |";
  const change = cellWriteChange(line, 0, 2, "x | y");
  expect(applyChange(line, change)).toBe("| a | b | x \\| y |");
});

// A minimal EditorView mock: the table helpers only need view.state and
// view.dispatch. dispatch applies the transaction so successive reads see the
// updated document.
function viewWith(doc: string): EditorView {
  let state = EditorState.create({ doc });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: Parameters<EditorView["dispatch"]>) {
      state = state.update(...specs).state;
    },
  } as EditorView;
}

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

test("findLenientTables always renders, even when the caret is in the table", () => {
  // Tables are now edited inside the rendered grid widget; the raw source is
  // never revealed for a caret inside the table.
  const doc = `text\n\n${lenientTable}`;
  const tableStart = stateWith(doc, 0).doc.line(3).from;
  const state = stateWith(doc, tableStart); // caret inside the table
  const out: { from: number; to: number }[] = [];
  findLenientTables(state, [], out as never);
  expect(out).toHaveLength(1);
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

// ---- escapeCellPipes -----------------------------------------------------

test("escapeCellPipes escapes free pipes but leaves code-span pipes alone", () => {
  expect(escapeCellPipes("a | b")).toBe("a \\| b");
  // Pipes inside a backtick code span are content, not delimiters.
  expect(escapeCellPipes('`"light" | "dark" | "auto"`')).toBe('`"light" | "dark" | "auto"`');
  // Already-escaped pipes are not double-escaped.
  expect(escapeCellPipes("a \\| b")).toBe("a \\| b");
});

// ---- cellsInRange --------------------------------------------------------

test("cellsInRange returns each cell's document offsets", () => {
  const line = "| a | b |";
  const cells = cellsInRange(line, 100);
  expect(cells).toHaveLength(2);
  expect(cells[0]!.text).toBe(" a ");
  expect(cells[0]!.from).toBe(101);
  expect(cells[0]!.to).toBe(104);
  expect(cells[1]!.text).toBe(" b ");
  expect(cells[1]!.from).toBe(105);
  expect(cells[1]!.to).toBe(108);
});

test("cellsInRange keeps a code-span pipe out of the split", () => {
  const cells = cellsInRange("| `a | b` | c |", 0);
  expect(cells).toHaveLength(2);
  expect(cells[0]!.text).toBe(" `a | b` ");
  expect(cells[1]!.text).toBe(" c ");
});

// ---- renderCellHTML -------------------------------------------------------

test("renderCellHTML renders code spans, emphasis and links", () => {
  expect(renderCellHTML("`code`")).toBe("<code>code</code>");
  expect(renderCellHTML("**b**")).toBe("<strong>b</strong>");
  expect(renderCellHTML("*i*")).toBe("<em>i</em>");
  expect(renderCellHTML("~~s~~")).toBe("<s>s</s>");
  expect(renderCellHTML("[x](https://a.com)")).toBe('<a href="https://a.com">x</a>');
});

test("renderCellHTML renders raw HTML and escapes plain text", () => {
  expect(renderCellHTML("<b>bold</b>")).toBe("<b>bold</b>");
  expect(renderCellHTML("a < b")).toBe("a &lt; b");
});

test("renderCellHTML keeps a union type's pipes inside its code span", () => {
  expect(renderCellHTML('`"light" | "dark" | "auto"`')).toBe(
    '<code>"light" | "dark" | "auto"</code>',
  );
});

// ---- addTableRow / addTableColumn / deleteTable -------------------------

const simpleTable = "| a | b |\n| --- | --- |\n| 1 | 2 |";

test("addTableRow appends an empty body row matching the column count", () => {
  const view = viewWith(simpleTable);
  addTableRow(view, 0);
  expect(view.state.doc.toString()).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n| | |");
});

test("addTableColumn adds a cell to every row", () => {
  const view = viewWith(simpleTable);
  addTableColumn(view, 0);
  const lines = view.state.doc.toString().split("\n");
  expect(splitCells(lines[0]!)).toEqual(["a", "b", ""]);
  expect(splitCells(lines[1]!)).toEqual(["---", "---", "---"]);
  expect(splitCells(lines[2]!)).toEqual(["1", "2", ""]);
});

test("deleteTable removes the table and one trailing newline", () => {
  const view = viewWith(`before\n\n${simpleTable}\n\nafter`);
  const tableFrom = "before\n\n".length;
  deleteTable(view, tableFrom);
  expect(view.state.doc.toString()).toBe("before\n\nafter");
});
