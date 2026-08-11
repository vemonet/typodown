// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { typodownMarkdown, wrap } from "../src/editor.ts";

/** Run `wrap(marker)` with the caret at `caret` and return the new document. */
function wrapAt(doc: string, caret: number, marker = "`"): string {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown()],
      selection: { anchor: caret },
    }),
  });
  wrap(marker)(view);
  const out = view.state.doc.toString();
  view.destroy();
  return out;
}

test("expands to the whole file name, extension included", () => {
  const doc = "open test.md now";
  // Caret inside "test", before the dot.
  expect(wrapAt(doc, doc.indexOf("test") + 2)).toBe("open `test.md` now");
  // Caret inside the extension.
  expect(wrapAt(doc, doc.indexOf(".md") + 2)).toBe("open `test.md` now");
});

test("keeps a sentence's full stop out of the wrapped word", () => {
  const doc = "the end.";
  expect(wrapAt(doc, 5)).toBe("the `end`.");
});

test("expands over kebab-case and paths but not the punctuation around them", () => {
  expect(wrapAt("a live-preview x", 8)).toBe("a `live-preview` x");
  expect(wrapAt("in src/theme.css here", 12)).toBe("in `src/theme.css` here");
  expect(wrapAt("a -- b", 3)).toBe("a -``- b"); // no word here: an empty pair at the caret
});

test("the same expansion applies to bold", () => {
  const doc = "edit test.md today";
  expect(wrapAt(doc, doc.indexOf("test") + 1, "**")).toBe("edit **test.md** today");
});
