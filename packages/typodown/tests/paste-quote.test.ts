import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { typodownMarkdown, quoteMultilinePaste } from "../src/editor.ts";

// caret marked by `|` in the doc string.
function pasteAt(doc: string, text: string): string {
  const caret = doc.indexOf("|");
  const clean = doc.replace("|", "");
  const state = EditorState.create({
    doc: clean,
    extensions: [typodownMarkdown()],
    selection: { anchor: caret },
  });
  return quoteMultilinePaste(state, text);
}

test("multi-line paste inside a blockquote prefixes every new line", () => {
  expect(pasteAt("> start|", "one\ntwo\nthree")).toBe("one\n> two\n> three");
});

test("paste inside a callout continues the quote", () => {
  expect(pasteAt("> [!NOTE] title|", "a\nb")).toBe("a\n> b");
});

test("nested blockquote keeps the full prefix", () => {
  expect(pasteAt("> > deep|", "a\nb")).toBe("a\n> > b");
});

test("blank pasted lines keep a bare marker (no trailing space)", () => {
  expect(pasteAt("> q|", "a\n\nb")).toBe("a\n>\n> b");
});

test("indented blockquote keeps its leading whitespace", () => {
  expect(pasteAt("  > q|", "a\nb")).toBe("a\n  > b");
});

test("single-line paste is unchanged", () => {
  expect(pasteAt("> q|", "just one line")).toBe("just one line");
});

test("paste outside a quote is unchanged", () => {
  expect(pasteAt("plain text|", "a\nb")).toBe("a\nb");
});
