import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { typodownMarkdown, insertParagraph, wrap } from "../src/editor.ts";

// Headless mock of EditorView: tracks the current state and applies dispatched
// transactions. Enough to exercise a Command (needs only view.state + view.dispatch).
function mockView(doc: string, caret: number, selTo?: number): EditorView {
  let state = EditorState.create({
    doc,
    extensions: [typodownMarkdown()],
    selection: selTo != null ? { anchor: caret, head: selTo } : { anchor: caret },
  });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: Parameters<EditorView["dispatch"]>) {
      state = state.update(...specs).state;
    },
  } as EditorView;
}

function runInsertParagraph(doc: string, caret: number): string {
  const view = mockView(doc, caret);
  insertParagraph(view);
  return view.state.doc.toString();
}

function runWrap(
  marker: string,
  doc: string,
  caret: number,
  selTo?: number,
): { doc: string; head: number } {
  const view = mockView(doc, caret, selTo);
  wrap(marker)(view);
  return { doc: view.state.doc.toString(), head: view.state.selection.main.head };
}

// ---- front matter / html newline ------------------------------------------

test("Enter inside front matter inserts a single newline", () => {
  const doc = "---\ntitle: hi\ntags: []\n---";
  const caret = doc.indexOf(":") + 1; // right after the colon in "title:"
  // A single newline is inserted (like in a code block), not a paragraph gap.
  expect(runInsertParagraph(doc, caret)).toBe("---\ntitle:\n hi\ntags: []\n---");
});

test("Enter inside front matter on a blank content line inserts one newline", () => {
  const doc = "---\n\n---";
  const caret = 4; // on the blank content line
  expect(runInsertParagraph(doc, caret)).toBe("---\n\n\n---");
});

test("Enter inside an HTML block inserts a single newline", () => {
  const doc = "<div>\nhello\n</div>";
  const caret = doc.indexOf("hello") + 2; // after "he" in "hello"
  expect(runInsertParagraph(doc, caret)).toBe("<div>\nhe\nllo\n</div>");
});

test("Enter outside front matter still splits paragraphs", () => {
  const doc = "---\ntitle: hi\n---\n\nfoobar";
  const caret = doc.indexOf("foobar") + 3; // after "foo" in "foobar"
  // Paragraph split: two newlines, not one.
  expect(runInsertParagraph(doc, caret)).toBe("---\ntitle: hi\n---\n\nfoo\n\nbar");
});

// ---- emphasis toggle-off ---------------------------------------------------

test("Cmd+B (wrap **) inside bold removes the bold markers", () => {
  const doc = "**bold**";
  const caret = doc.indexOf("bold") + 2; // after "bo"
  const { doc: result, head } = runWrap("**", doc, caret);
  expect(result).toBe("bold");
  expect(head).toBe(2); // same spot in the unwrapped text
});

test("Cmd+I (wrap *) inside italic removes the italic markers", () => {
  const doc = "*italic*";
  const caret = doc.indexOf("italic") + 3;
  const { doc: result } = runWrap("*", doc, caret);
  expect(result).toBe("italic");
});

test("Cmd+B inside bold keeps italic (nested emphasis)", () => {
  // "***text***" is Emphasis > StrongEmphasis; caret inside.
  const doc = "***text***";
  const caret = doc.indexOf("text") + 2;
  const { doc: result } = runWrap("**", doc, caret);
  expect(result).toBe("*text*");
});

test("Cmd+I inside italic nested in bold removes only the italic", () => {
  const doc = "**a *b* c**";
  const caret = doc.indexOf("b"); // inside the italic 'b'
  const { doc: result } = runWrap("*", doc, caret);
  expect(result).toBe("**a b c**");
});

test("Cmd+B with the caret on a plain word wraps the whole word", () => {
  const doc = "plain";
  const caret = 2; // inside the word, no selection
  const { doc: result, head } = runWrap("**", doc, caret);
  expect(result).toBe("**plain**");
  expect(head).toBe(7); // the wrapped word is selected (inside the markers)
});

test("Cmd+B with the caret not on a word inserts an empty marker pair", () => {
  const doc = "hi ";
  const caret = 3; // after the trailing space, not on a word char
  const { doc: result, head } = runWrap("**", doc, caret);
  expect(result).toBe("hi ****");
  expect(head).toBe(5); // caret between the markers
});

test("backtick inside inline code removes the code markers", () => {
  const doc = "`code`";
  const from = doc.indexOf("od");
  const to = from + 2; // select "od"
  const { doc: result } = runWrap("`", doc, from, to);
  expect(result).toBe("code");
});

test("wrap with selection matching the construct content toggles off", () => {
  const doc = "**bold**";
  const from = doc.indexOf("bold");
  const to = from + 4; // select "bold"
  const { doc: result } = runWrap("**", doc, from, to);
  expect(result).toBe("bold");
});

test("wrap with selection in plain text wraps it (no toggle)", () => {
  const doc = "some plain text";
  const from = doc.indexOf("plain");
  const to = from + 5; // select "plain"
  const { doc: result } = runWrap("**", doc, from, to);
  expect(result).toBe("some **plain** text");
});
