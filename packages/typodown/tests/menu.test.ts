import { expect, test } from "vite-plus/test";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertTable, tableMarkdown } from "../src/menu.ts";

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
