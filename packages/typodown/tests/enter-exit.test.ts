import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { typodownMarkdown, exitMarkupOnEmptyEnter } from "../src/editor.ts";

// Headless mock of EditorView: just tracks the current state and applies
// dispatched transactions. Enough to exercise a Command (which only needs
// view.state + view.dispatch) without a DOM.
function runEnter(doc: string, caret: number): string {
  let state = EditorState.create({
    doc,
    extensions: [typodownMarkdown()],
    selection: { anchor: caret },
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: Parameters<EditorView["dispatch"]>) {
      state = state.update(...specs).state;
    },
  } as EditorView;
  const handled = exitMarkupOnEmptyEnter(view);
  expect(handled).toBe(true);
  return state.doc.toString();
}

test("Enter on an empty bullet exits the list", () => {
  // "- foo\n- " with caret at the end of the empty second item.
  const doc = "- foo\n- ";
  expect(syntaxTree(EditorState.create({ doc, extensions: [typodownMarkdown()] })).length).toBe(
    doc.length,
  );
  expect(runEnter(doc, doc.length)).toBe("- foo\n");
});

test("Enter on an empty first bullet exits the list", () => {
  const doc = "- ";
  expect(runEnter(doc, doc.length)).toBe("");
});

test("Enter on an empty checkbox exits the task list", () => {
  const doc = "- [ ] foo\n- [ ] ";
  expect(runEnter(doc, doc.length)).toBe("- [ ] foo\n");
});

test("Enter on an empty nested bullet dedents one level", () => {
  // "- outer\n  - " -> dedent the empty inner item to the outer level.
  const doc = "- outer\n  - ";
  expect(runEnter(doc, doc.length)).toBe("- outer\n- ");
});

test("Enter on an empty quote exits the blockquote", () => {
  const doc = "> foo\n> ";
  expect(runEnter(doc, doc.length)).toBe("> foo\n");
});

test("Enter on an empty nested quote dedents one level", () => {
  const doc = "> a\n> > ";
  expect(runEnter(doc, doc.length)).toBe("> a\n> ");
});

test("Enter on a non-empty bullet is not handled (falls through to continue)", () => {
  // "- foo" has content, so exitMarkupOnEmptyEnter must return false.
  let state = EditorState.create({
    doc: "- foo",
    extensions: [typodownMarkdown()],
    selection: { anchor: 5 },
  });
  const view = {
    get state() {
      return state;
    },
    dispatch() {},
  } as EditorView;
  expect(exitMarkupOnEmptyEnter(view)).toBe(false);
});
