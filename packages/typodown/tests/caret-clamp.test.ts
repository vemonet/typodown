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

// ---- selection edges (same rule as the caret) ---------------------------

/** The selection a range collapses to once the filter has run. */
function clampRange(doc: string, anchor: number, head: number): { from: number; to: number } {
  const s = EditorState.create({
    doc,
    extensions: [typodownMarkdown(), clampCursorPastMarker],
  });
  const main = s.update({ selection: EditorSelection.range(anchor, head) }).selection!.main;
  return { from: main.from, to: main.to };
}

test("filter clamps a selection edge inside a bullet prefix", () => {
  // Shift+Home from mid-line: the selection starts at the first character.
  expect(clampRange("- foo", 5, 0)).toEqual({ from: 2, to: 5 });
  expect(clampRange("- foo", 4, 1)).toEqual({ from: 2, to: 4 });
  expect(clampRange("- foo", 0, 3)).toEqual({ from: 2, to: 3 });
});

test("filter clamps a selection edge inside a checkbox prefix", () => {
  // "- [ ] foo": content starts at 6.
  expect(clampRange("- [ ] foo", 9, 0)).toEqual({ from: 6, to: 9 });
  expect(clampRange("- [ ] foo", 9, 3)).toEqual({ from: 6, to: 9 });
});

test("filter clamps a selection edge inside a quote prefix", () => {
  expect(clampRange("> foo", 5, 0)).toEqual({ from: 2, to: 5 });
});

test("filter clamps a selection ending at the start of a marker line", () => {
  // Dragging down from the line above onto the bullet line: the end lands at
  // the first character rather than inside the hidden marker.
  expect(clampRange("a\n- foo", 0, 2)).toEqual({ from: 0, to: 4 });
});

test("filter keeps the markup in a selection that spans past the line", () => {
  // Select-all and any multi-line drag carry whole lines, markup included.
  expect(clampRange("- foo\n- bar", 0, 11)).toEqual({ from: 0, to: 11 });
  expect(clampRange("- foo\n- bar", 11, 0)).toEqual({ from: 0, to: 11 });
  // Only the start of such a range is exempt: its end still lands on the next
  // line's first character (8), never inside that line's marker.
  expect(clampRange("- foo\n- bar", 0, 6)).toEqual({ from: 0, to: 8 });
  expect(clampRange("- foo\n- bar", 0, 7)).toEqual({ from: 0, to: 8 });
});

test("filter leaves selections on a plain paragraph alone", () => {
  expect(clampRange("foo", 0, 3)).toEqual({ from: 0, to: 3 });
});

// ---- arrowLeftPastMarker (Left exits a marker line) ----------------------

function runLeft(
  doc: string,
  caret: number,
  extend = false,
  anchor = caret,
): { handled: boolean; pos: number; anchor: number } {
  let state = EditorState.create({
    doc,
    extensions: [typodownMarkdown(), clampCursorPastMarker],
    selection: EditorSelection.range(anchor, caret),
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: Parameters<EditorView["dispatch"]>) {
      state = state.update(...specs).state;
    },
  } as EditorView;
  const handled = arrowLeftPastMarker(view, extend);
  return {
    handled,
    pos: state.selection!.main.head,
    anchor: state.selection!.main.anchor,
  };
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

test("Shift+Left from a content start extends to the previous line end", () => {
  const { handled, pos, anchor } = runLeft("text\n- foo", 7, true, 9);
  expect(handled).toBe(true);
  expect(pos).toBe(4); // end of "text"
  expect(anchor).toBe(9); // anchor kept
});

test("Shift+Left elsewhere on the line is not handled", () => {
  expect(runLeft("text\n- foo", 9, true, 10).handled).toBe(false);
});

test("Left with a non-empty selection is not handled", () => {
  expect(runLeft("text\n- foo", 7, false, 9).handled).toBe(false);
});
