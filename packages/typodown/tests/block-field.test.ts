// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { typodownMarkdown } from "../src/editor.ts";
import { blockField } from "../src/live-preview.ts";

const field = blockField({ html: true });

function stateOf(doc: string, anchor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [typodownMarkdown(), field],
  });
}

function decoCount(state: EditorState): number {
  return state.field(field).deco.size;
}

const DOC = "# Title\n\n$$\nx^2 + y^2\n$$\n\nSome text here.\n";
const mathStart = DOC.indexOf("$$");

test("a math block renders as a widget while the caret is elsewhere", () => {
  expect(decoCount(stateOf(DOC, 0))).toBe(1);
});

test("the widget is suppressed while the caret is inside the block", () => {
  expect(decoCount(stateOf(DOC, mathStart + 4))).toBe(0);
});

test("a caret move that stays outside the block reuses the field value", () => {
  const s1 = stateOf(DOC, 0);
  const before = s1.field(field);
  // Move the caret within "Some text here." -- no sensitive boundary crossed.
  const s2 = s1.update({ selection: { anchor: DOC.indexOf("Some") + 2 } }).state;
  expect(s2.field(field)).toBe(before);
});

test("a caret move into the block rebuilds and hides the widget", () => {
  const s1 = stateOf(DOC, 0);
  const before = s1.field(field);
  const s2 = s1.update({ selection: { anchor: mathStart + 4 } }).state;
  const after = s2.field(field);
  expect(after).not.toBe(before);
  expect(after.deco.size).toBe(0);
});

test("a caret move back out of the block restores the widget", () => {
  const s1 = stateOf(DOC, mathStart + 4);
  const s2 = s1.update({ selection: { anchor: 0 } }).state;
  expect(decoCount(s2)).toBe(1);
});

test("a doc change still rebuilds (new table appears)", () => {
  const s1 = stateOf("plain paragraph\n", 0);
  expect(decoCount(s1)).toBe(0);
  const table = "\n| a | b |\n| - | - |\n| 1 | 2 |\n";
  const s2 = s1.update({ changes: { from: s1.doc.length, insert: table } }).state;
  expect(decoCount(s2)).toBe(1);
});
