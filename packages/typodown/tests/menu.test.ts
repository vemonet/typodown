import { expect, test } from "vite-plus/test";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertTable, tableMarkdown, defaultMenuItems } from "../src/menu.ts";

// A minimal EditorView mock: the helpers only need view.state and view.dispatch.
// dispatch applies the transaction so successive reads see the updated document.
function viewWith(doc: string, selFrom = 0, selTo?: number): EditorView {
  const selection =
    selTo === undefined ? EditorSelection.single(selFrom) : EditorSelection.single(selFrom, selTo);
  let state = EditorState.create({ doc, selection });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: Parameters<EditorView["dispatch"]>) {
      state = state.update(...specs).state;
    },
  } as EditorView;
}

// ---- tableMarkdown --------------------------------------------------------

test("tableMarkdown builds a 1x1 table (1 body row, 1 column)", () => {
  const md = tableMarkdown(1, 1);
  const lines = md.split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe("|  |");
  expect(lines[1]).toBe("| --- |");
  expect(lines[2]).toBe("|  |");
});

test("tableMarkdown builds a 2x3 table (2 body rows, 3 columns)", () => {
  const md = tableMarkdown(2, 3);
  const lines = md.split("\n");
  expect(lines).toHaveLength(4);
  // Header and body rows have 4 pipes = 3 cells.
  expect((lines[0]!.match(/\|/g) ?? []).length).toBe(4);
  expect((lines[2]!.match(/\|/g) ?? []).length).toBe(4);
  expect((lines[3]!.match(/\|/g) ?? []).length).toBe(4);
  // Delimiter row.
  expect(lines[1]).toBe("| --- | --- | --- |");
});

test("tableMarkdown clamps rows and cols to a minimum of 1", () => {
  expect(tableMarkdown(0, 0).split("\n")).toHaveLength(3);
  expect(tableMarkdown(-3, -1).split("\n")).toHaveLength(3);
});

test("tableMarkdown floors non-integer values", () => {
  expect(tableMarkdown(2.9, 3.9).split("\n")).toHaveLength(4);
});

// ---- insertTable ----------------------------------------------------------

test("insertTable on an empty line replaces it with the table", () => {
  const view = viewWith("", 0);
  insertTable(view, 2, 2);
  const md = view.state.doc.toString();
  const lines = md.split("\n");
  expect(lines).toHaveLength(4);
  expect(lines[0]).toBe("|  |  |");
  expect(lines[1]).toBe("| --- | --- |");
  // Caret lands in the first body cell (third line, after "| ").
  const caret = view.state.selection.main.head;
  expect(caret).toBe(lines[0]!.length + 1 + lines[1]!.length + 1 + 2);
});

test("insertTable on a non-empty line inserts below with a blank separator", () => {
  const view = viewWith("hello world", 5);
  insertTable(view, 1, 1);
  const md = view.state.doc.toString();
  expect(md.startsWith("hello world\n\n|  |")).toBe(true);
  // Caret lands in the body cell.
  const caret = view.state.selection.main.head;
  expect(md.slice(caret - 2, caret)).toBe("| ");
});

test("insertTable places the caret in the first body cell", () => {
  const view = viewWith("\n", 0);
  insertTable(view, 3, 2);
  const md = view.state.doc.toString();
  const caret = view.state.selection.main.head;
  // The caret should be on the third line (first body row), right after "| ".
  const caretLine = view.state.doc.lineAt(caret);
  expect(caretLine.text).toBe("|  |  |");
  expect(caret - caretLine.from).toBe(2);
  expect(md.slice(caretLine.from, caret)).toBe("| ");
});

// ---- defaultMenuItems -----------------------------------------------------

test("defaultMenuItems returns native items and Add table with separators", () => {
  const view = viewWith("", 0);
  const items = defaultMenuItems({ view, pos: 0 });
  const labels = items.filter((i) => !i.separator).map((i) => i.label);
  expect(labels).toEqual(["Cut", "Copy", "Paste", "Undo", "Redo", "Add table"]);
  // Two separators: after Paste and after Redo.
  expect(items.filter((i) => i.separator)).toHaveLength(2);
  for (const item of items) {
    if (!item.separator) expect(typeof item.action).toBe("function");
  }
});

test("defaultMenuItems disables Cut and Copy when nothing is selected", () => {
  const view = viewWith("hello", 0); // empty caret
  const items = defaultMenuItems({ view, pos: 0 });
  expect(items.find((i) => i.label === "Cut")!.disabled).toBe(true);
  expect(items.find((i) => i.label === "Copy")!.disabled).toBe(true);
  // Paste is always available.
  expect(items.find((i) => i.label === "Paste")!.disabled).toBeFalsy();
});

test("defaultMenuItems enables Cut and Copy when there is a selection", () => {
  const view = viewWith("hello", 0, 3); // selection 0..3
  const items = defaultMenuItems({ view, pos: 0 });
  expect(items.find((i) => i.label === "Cut")!.disabled).toBe(false);
  expect(items.find((i) => i.label === "Copy")!.disabled).toBe(false);
});

test("defaultMenuItems disables Undo and Redo when history is empty", () => {
  const view = viewWith("hello", 0);
  const items = defaultMenuItems({ view, pos: 0 });
  expect(items.find((i) => i.label === "Undo")!.disabled).toBe(true);
  expect(items.find((i) => i.label === "Redo")!.disabled).toBe(true);
});
