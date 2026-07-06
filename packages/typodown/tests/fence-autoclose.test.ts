import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { typodownMarkdown, closeFenceOnThirdBacktick } from "../src/editor.ts";

// Headless mock of EditorView: just tracks the current state and applies
// dispatched transactions. Enough to exercise a Command (which only needs
// view.state + view.dispatch) without a DOM.
function runBacktick(doc: string, caret: number): { doc: string; caret: number; handled: boolean } {
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
  const handled = closeFenceOnThirdBacktick(view);
  return { doc: state.doc.toString(), caret: state.selection.main.head, handled };
}

test("third backtick on a two-backtick line closes the fence", () => {
  // "``" with caret at the end -> "```\n\n```", caret at the info-string spot.
  const { doc, caret, handled } = runBacktick("``", 2);
  expect(handled).toBe(true);
  expect(doc).toBe("```\n\n```");
  expect(caret).toBe(3);
});

test("third backtick preserves leading whitespace on the opening fence", () => {
  const { doc, caret, handled } = runBacktick("  ``", 4);
  expect(handled).toBe(true);
  expect(doc).toBe("  ```\n\n```");
  expect(caret).toBe(5);
});

test("not triggered with content after the caret on the line", () => {
  // "``foo" with caret at the start (before "foo") - not at line end.
  const { doc, caret, handled } = runBacktick("``foo", 2);
  expect(handled).toBe(false);
  expect(doc).toBe("``foo");
  expect(caret).toBe(2);
});

test("not triggered when the line has more than two backticks", () => {
  const { doc, caret, handled } = runBacktick("````", 4);
  expect(handled).toBe(false);
  expect(doc).toBe("````");
  expect(caret).toBe(4);
});

test("not triggered with an active selection", () => {
  let state = EditorState.create({
    doc: "``",
    extensions: [typodownMarkdown()],
    selection: { anchor: 0, head: 2 },
  });
  const view = {
    get state() {
      return state;
    },
    dispatch() {},
  } as EditorView;
  expect(closeFenceOnThirdBacktick(view)).toBe(false);
  expect(state.doc.toString()).toBe("``");
});

test("not triggered inside a fenced code block (would be the closing fence)", () => {
  // Caret at the end of "``" inside an existing fenced code block.
  const doc = "```\ncode\n``";
  const { doc: newDoc, handled } = runBacktick(doc, doc.length);
  expect(handled).toBe(false);
  expect(newDoc).toBe(doc);
});
