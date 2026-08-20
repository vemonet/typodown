// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { typodownMarkdown } from "../src/editor.ts";
import { livePreview } from "../src/live-preview.ts";

/** The visual lines the editor draws, which is the point of the feature: one
 * entry per rendered line, not per source line. */
function lines(doc: string, join = true): string[] {
  const state = EditorState.create({
    doc,
    extensions: [typodownMarkdown(), livePreview({ html: true, joinSoftBreaks: join })],
  });
  ensureSyntaxTree(state, state.doc.length, 200);
  const view = new EditorView({ state, parent: document.body });
  const rendered = [...view.contentDOM.querySelectorAll(".cm-line")].map((line) =>
    (line.textContent ?? "").trim(),
  );
  view.destroy();
  return rendered.filter((line) => line.length > 0);
}

test("a paragraph wrapped over two source lines renders as one line", () => {
  expect(lines("The markdown text is the\nsingle source of truth.\n")).toEqual([
    "The markdown text is the single source of truth.",
  ]);
});

test("every break of a longer paragraph is joined", () => {
  expect(lines("one\ntwo\nthree\nfour\n")).toEqual(["one two three four"]);
});

test("separate paragraphs stay separate", () => {
  expect(lines("first para\n\nsecond para\n")).toEqual(["first para", "second para"]);
});

test("a hard break (two trailing spaces) still breaks the line", () => {
  expect(lines("line one  \nline two\n")).toEqual(["line one", "line two"]);
});

test("a backslash hard break still breaks the line", () => {
  expect(lines("line one\\\nline two\n")).toEqual(["line one\\", "line two"]);
});

test("a quoted paragraph joins without its continuation marker", () => {
  expect(lines("> quoted one\n> quoted two\n")).toEqual(["quoted one quoted two"]);
});

test("an alert keeps its text off the [!TIP] label line", () => {
  expect(lines("> [!TIP]\n> A standalone UMD build.\n")).toEqual([
    "[!TIP]",
    "A standalone UMD build.",
  ]);
});

test("the body of an alert still joins", () => {
  expect(lines("> [!NOTE]\n> first body line\n> second body line\n")).toEqual([
    "[!NOTE]",
    "first body line second body line",
  ]);
});

test("a list item joins without its continuation indent", () => {
  expect(lines("- item one\n  item two\n")).toEqual(["item one item two"]);
});

test("a heading is not joined with the paragraph following it", () => {
  expect(lines("# Title\nparagraph text\n")).toEqual(["# Title", "paragraph text"]);
});

test("code block lines are not joined", () => {
  expect(lines("```\nfirst\nsecond\n```\n")).toEqual(["first", "second"]);
});

test("joining off keeps every source line on its own line", () => {
  expect(lines("The markdown text is the\nsingle source of truth.\n", false)).toEqual([
    "The markdown text is the",
    "single source of truth.",
  ]);
});
