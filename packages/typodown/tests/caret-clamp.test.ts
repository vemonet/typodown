import { expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { typodownMarkdown, clampCursorPastMarker, arrowLeftPastMarker } from "../src/editor.ts";
import { markerEndOnLine } from "../src/live-preview.ts";

function parseState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [typodownMarkdown()] });
}

// ---- markerEndOnLine ------------------------------------------------------

test("markerEndOnLine finds the bullet prefix end", () => {
  const s = parseState("- foo");
  expect(markerEndOnLine(s, s.doc.line(1))).toBe(2);
});

test("markerEndOnLine finds the checkbox prefix end", () => {
  const s = parseState("- [ ] foo");
  expect(markerEndOnLine(s, s.doc.line(1))).toBe(6);
});

test("markerEndOnLine finds the quote prefix end", () => {
  const s = parseState("> foo");
  expect(markerEndOnLine(s, s.doc.line(1))).toBe(2);
});

test("markerEndOnLine finds a nested quote prefix end", () => {
  const s = parseState("> > foo");
  expect(markerEndOnLine(s, s.doc.line(1))).toBe(4);
});

test("markerEndOnLine includes leading indent for nested bullets", () => {
  const s = parseState("- a\n  - b");
  // line 2 is "  - b" starting at offset 4; prefix "  - " is 4 chars -> 8.
  expect(markerEndOnLine(s, s.doc.line(2))).toBe(8);
});

test("markerEndOnLine returns null for a plain paragraph", () => {
  const s = parseState("foo");
  expect(markerEndOnLine(s, s.doc.line(1))).toBeNull();
});

test("markerEndOnLine returns null for ordered lists (number stays visible)", () => {
  const s = parseState("1. foo");
  expect(markerEndOnLine(s, s.doc.line(1))).toBeNull();
});

test("markerEndOnLine returns null for a dash inside a code block", () => {
  const s = parseState("```\n- not a list\n```");
  expect(markerEndOnLine(s, s.doc.line(2))).toBeNull();
});

// ---- clampCursorPastMarker (transaction filter) --------------------------

function clampAt(doc: string, pos: number): number {
  const s = EditorState.create({
    doc,
    extensions: [typodownMarkdown(), clampCursorPastMarker],
  });
  return s.update({ selection: { anchor: pos } }).selection!.main.head;
}

test("filter clamps a caret before a bullet to the content start", () => {
  expect(clampAt("- foo", 0)).toBe(2);
  expect(clampAt("- foo", 1)).toBe(2);
});

test("filter leaves a caret at/after the content start alone", () => {
  expect(clampAt("- foo", 2)).toBe(2);
  expect(clampAt("- foo", 3)).toBe(3);
});

test("filter clamps a caret before a checkbox", () => {
  expect(clampAt("- [ ] foo", 0)).toBe(6);
  expect(clampAt("- [ ] foo", 5)).toBe(6);
});

test("filter clamps a caret before a quote marker", () => {
  expect(clampAt("> foo", 0)).toBe(2);
  expect(clampAt("> foo", 1)).toBe(2);
});

test("filter leaves a plain paragraph line alone", () => {
  expect(clampAt("foo", 0)).toBe(0);
});

test("filter skips a single blank paragraph separator", () => {
  const doc = "Par1\n\nPar2";
  expect(clampAt(doc, 5)).toBe(6);
  expect(clampAt("Par1\n\n# Heading", 5)).toBe(6);

  const state = EditorState.create({
    doc,
    extensions: [typodownMarkdown(), clampCursorPastMarker],
    selection: { anchor: doc.length },
  });
  const tr = state.update({ selection: EditorSelection.cursor(5, -1) });
  expect(tr.selection!.main.head).toBe(4);
});

test("filter leaves intentional extra blank lines and code blanks editable", () => {
  expect(clampAt("Par1\n\n\nPar2", 5)).toBe(5);
  expect(clampAt("```\none\n\ntwo\n```", 8)).toBe(8);
});

test("filter leaves non-empty selections alone", () => {
  const s = EditorState.create({
    doc: "- foo",
    extensions: [typodownMarkdown(), clampCursorPastMarker],
  });
  const tr = s.update({ selection: EditorSelection.range(0, 3) });
  expect(tr.selection!.main.from).toBe(0);
  expect(tr.selection!.main.to).toBe(3);
});

// ---- arrowLeftPastMarker (Left exits a marker line) ----------------------

function runLeft(doc: string, caret: number): { handled: boolean; pos: number } {
  let state = EditorState.create({
    doc,
    extensions: [typodownMarkdown(), clampCursorPastMarker],
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
  const handled = arrowLeftPastMarker(view);
  return { handled, pos: state.selection!.main.head };
}

test("Left from a bullet's content start exits to the previous line end", () => {
  // "text\n- foo" -- markEnd of "- foo" is 7 (offset of 'f'); line 1's to is 4
  const { handled, pos } = runLeft("text\n- foo", 7);
  expect(handled).toBe(true);
  expect(pos).toBe(4); // end of "text"
});

test("Left from a checkbox's content start exits to the previous line", () => {
  // "a\n- [ ] b" -- markEnd is 8 (offset of 'b'); line 1's to is 1
  const { handled, pos } = runLeft("a\n- [ ] b", 8);
  expect(handled).toBe(true);
  expect(pos).toBe(1); // end of "a"
});

test("Left from a quote's content start exits to the previous line", () => {
  // "a\n> b" -- markEnd is 4 ('a'=0, '\n'=1, '>'=2, ' '=3, 'b'=4)
  const { handled, pos } = runLeft("a\n> b", 4);
  expect(handled).toBe(true);
  expect(pos).toBe(1); // end of "a"
});

test("Left from inside the content (not at the start) is not handled", () => {
  // "- foo" -- caret at 'o' of "foo" (offset 4), not at markEnd (2)
  const { handled } = runLeft("- foo", 4);
  expect(handled).toBe(false);
});

test("Left from a marker line that is the first line is not handled", () => {
  // "- foo" -- markEnd is 2, but it's the first line (nowhere to exit to)
  const { handled } = runLeft("- foo", 2);
  expect(handled).toBe(false);
});

test("Left from a non-marker line is not handled", () => {
  const { handled } = runLeft("foo", 1);
  expect(handled).toBe(false);
});
