// @vitest-environment jsdom
//
// Raw Markdown is revealed by a selection that sits *inside* a construct (a
// caret on it, or a selection that stays within it). A selection reaching
// outside leaves the construct rendered, so dragging across a paragraph does
// not unfold links / tables under the pointer.
import { expect, test } from "vite-plus/test";
import { EditorSelection, EditorState, type SelectionRange } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { typodownMarkdown } from "../src/editor.ts";
import { livePreview } from "../src/live-preview.ts";

/** The text the editor actually draws for `doc` under `selection`. */
function rendered(doc: string, selection: SelectionRange): string {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([selection]),
    extensions: [typodownMarkdown(), livePreview({ html: true })],
  });
  ensureSyntaxTree(state, state.doc.length, 200);
  const view = new EditorView({ state, parent: document.body });
  const text = [...view.contentDOM.querySelectorAll(".cm-line")]
    .map((line) => line.textContent ?? "")
    .join("\n");
  view.destroy();
  return text;
}

const URL = "https://example.com/a/very/long/url";
const DOC = `See [the docs](${URL}) here.\n\nA second paragraph.\n`;
const linkFrom = DOC.indexOf("[the docs]");
const linkTo = DOC.indexOf(") here.") + 1;

test("a caret on a link reveals its raw markdown", () => {
  expect(rendered(DOC, EditorSelection.cursor(linkFrom + 2))).toContain(URL);
});

test("a selection inside a link keeps it revealed", () => {
  // Double-clicking "docs" inside the link text.
  const from = DOC.indexOf("docs");
  expect(rendered(DOC, EditorSelection.range(from, from + 4))).toContain(URL);
});

test("a selection reaching past a link leaves it rendered", () => {
  // Dragging from the start of the paragraph into the next one: the URL stays
  // folded, so the text under the pointer does not reflow.
  expect(rendered(DOC, EditorSelection.range(0, DOC.length))).not.toContain(URL);
  expect(rendered(DOC, EditorSelection.range(0, linkTo))).not.toContain(URL);
  expect(rendered(DOC, EditorSelection.range(linkFrom, linkTo + 3))).not.toContain(URL);
});

test("the document still holds the full markdown for copying", () => {
  const state = EditorState.create({
    doc: DOC,
    selection: EditorSelection.create([EditorSelection.range(0, DOC.length)]),
    extensions: [typodownMarkdown(), livePreview({ html: true })],
  });
  // What CodeMirror puts on the clipboard is the document slice, not the DOM.
  expect(state.sliceDoc(0, DOC.length)).toContain(`[the docs](${URL})`);
});

test("a selection reaching past a heading leaves its marker folded", () => {
  const doc = "# Title\n\nbody text\n";
  expect(rendered(doc, EditorSelection.cursor(0))).toContain("# Title");
  expect(rendered(doc, EditorSelection.range(0, doc.length))).not.toContain("# Title");
});
