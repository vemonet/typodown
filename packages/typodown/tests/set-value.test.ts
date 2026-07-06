import { expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { mapPosThroughReplacement, typodownMarkdown } from "../src/editor.ts";

// ---- mapPosThroughReplacement -------------------------------------------

test("empty old doc keeps the caret at 0", () => {
  expect(mapPosThroughReplacement("", "hello world", 0)).toBe(0);
});

test("identical docs leave the caret untouched", () => {
  expect(mapPosThroughReplacement("foo bar baz", "foo bar baz", 5)).toBe(5);
  expect(mapPosThroughReplacement("foo bar baz", "foo bar baz", 0)).toBe(0);
  expect(mapPosThroughReplacement("foo bar baz", "foo bar baz", 11)).toBe(11);
});

test("trailing-whitespace strip preserves a mid-doc caret", () => {
  // VS Code's "trim trailing whitespace on save": the space after "foo" is
  // dropped. Caret in "bar" should follow the suffix shift.
  // old "foo \nbar": f0 o1 o2 ' '3 \n4 b5 a6 r7
  // new "foo\nbar":  f0 o1 o2    \n3 b4 a5 r6
  expect(mapPosThroughReplacement("foo \nbar", "foo\nbar", 6)).toBe(5); // between 'a' and 'r'
  expect(mapPosThroughReplacement("foo \nbar", "foo\nbar", 5)).toBe(4); // between 'b' and 'a'
});

test("caret on the stripped line follows the delta", () => {
  // Caret at the '\n' (position 4) in old shifts left to '\n' (position 3).
  expect(mapPosThroughReplacement("foo \nbar", "foo\nbar", 4)).toBe(3);
});

test("final-newline append leaves a mid-doc caret untouched", () => {
  expect(mapPosThroughReplacement("foo\nbar", "foo\nbar\n", 5)).toBe(5);
  expect(mapPosThroughReplacement("foo\nbar", "foo\nbar\n", 7)).toBe(7);
});

test("caret inside a changed region clamps to the prefix end", () => {
  // "aaaaaaaaaa" -> "xxx": no common prefix/suffix, caret at 5 clamps to 0.
  expect(mapPosThroughReplacement("aaaaaaaaaa", "xxx", 5)).toBe(0);
  // "abcabcabc" -> "abcXYZabc": prefix=3 ("abc"), suffix=3 ("abc"),
  // changed region in old is [3, 6). Caret at 4 is inside -> clamps to 3.
  expect(mapPosThroughReplacement("abcabcabc", "abcXYZabc", 4)).toBe(3);
});

test("caret after the changed region shifts by the delta", () => {
  // old="abcabcabc" (len 9), new="abcXYZabc" (len 9), delta=0.
  // suffix=3 ("abc"), caret at 7 (in suffix) -> 7 + 0 = 7.
  expect(mapPosThroughReplacement("abcabcabc", "abcXYZabc", 7)).toBe(7);
  // Insertion: old="abc" (len 3), new="abXYZc" (len 6), delta=+3.
  // prefix=2 ("ab"), suffix=1 ("c"). Caret at 2 (boundary) stays; caret at 3 -> 6.
  expect(mapPosThroughReplacement("abc", "abXYZc", 2)).toBe(2);
  expect(mapPosThroughReplacement("abc", "abXYZc", 3)).toBe(6);
});

test("completely different docs clamp the caret to the start", () => {
  expect(mapPosThroughReplacement("old content here", "brand new doc", 10)).toBe(0);
});

// ---- end-to-end dispatch (the bug: caret must not jump to 0) ------------

// Replicates Typodown.setValue's dispatch on a headless mock view, so we can
// exercise the selection-mapping without a DOM.
function applySetValue(doc: string, caret: number, next: string): number {
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
  const ranges = state.selection.ranges.map((r) =>
    EditorSelection.range(
      mapPosThroughReplacement(doc, next, r.from),
      mapPosThroughReplacement(doc, next, r.to),
    ),
  );
  view.dispatch({
    changes: { from: 0, to: doc.length, insert: next },
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
  });
  return state.selection.main.head;
}

test("a naive whole-doc dispatch (no selection) dumps the caret at 0", () => {
  // The bug: CodeMirror maps any caret inside the replaced range to the start
  // of the inserted text (position 0) because the change starts at offset 0.
  let state = EditorState.create({
    doc: "line one\nline two",
    extensions: [typodownMarkdown()],
    selection: { anchor: 15 },
  });
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: "line one\nline two!" },
  }).state;
  expect(state.selection.main.head).toBe(0);
});

test("setValue keeps the caret where the user left it (identical doc)", () => {
  expect(applySetValue("line one\nline two", 15, "line one\nline two")).toBe(15);
});

test("setValue survives a trailing-whitespace strip on save", () => {
  // The README scenario: a line above the caret gets trimmed on save.
  const old = "settle back into place as you move on. \nThe content stays central.";
  const next = "settle back into place as you move on.\nThe content stays central.";
  const caret = old.length; // caret at the very end
  const mapped = applySetValue(old, caret, next);
  expect(mapped).toBe(next.length);
});

test("setValue keeps the caret mid-paragraph", () => {
  const old = "Move your caret into a heading, bold, code span or link.";
  expect(applySetValue(old, 30, old)).toBe(30);
});

test("setValue maps the caret through an insertion before it", () => {
  // old="foo\nbar" (len 7), new="foo\nINSERTED\nbar" (len 16), delta=+9.
  // old: f0 o1 o2 \n3 b4 a5 r6. Caret at 7 = end of doc.
  // prefix=4 ("foo\n"), suffix=3 ("bar"). Caret at 7 is in suffix -> 7 + 9 = 16.
  expect(applySetValue("foo\nbar", 7, "foo\nINSERTED\nbar")).toBe(16);
});
