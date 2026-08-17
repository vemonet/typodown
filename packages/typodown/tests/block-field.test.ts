// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { typodownMarkdown } from "../src/editor.ts";
import { blockField } from "../src/live-preview.ts";

const field = blockField({ html: true });

function stateOf(doc: string, anchor = 0): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [typodownMarkdown(), field],
  });
  ensureSyntaxTree(state, state.doc.length, 100);
  return state.update({}).state;
}

function widgetCount(state: EditorState, name: string): number {
  let count = 0;
  state.field(field).deco.between(0, state.doc.length, (_from, _to, decoration) => {
    if (decoration.spec.widget?.constructor.name === name) count++;
  });
  return count;
}

function firstWidget(state: EditorState, name: string): unknown {
  let widget: unknown;
  state.field(field).deco.between(0, state.doc.length, (_from, _to, decoration) => {
    if (!widget && decoration.spec.widget?.constructor.name === name) {
      widget = decoration.spec.widget;
    }
  });
  return widget;
}

const DOC = "# Title\n\n$$\nx^2 + y^2\n$$\n\nSome text here.\n";
const mathStart = DOC.indexOf("$$");

test("a math block renders as a widget while the caret is elsewhere", () => {
  expect(widgetCount(stateOf(DOC, 0), "MathWidget")).toBe(1);
});

test("the widget is suppressed while the caret is inside the block", () => {
  expect(widgetCount(stateOf(DOC, mathStart + 4), "MathWidget")).toBe(0);
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
  expect(widgetCount(s2, "MathWidget")).toBe(0);
});

test("a caret move back out of the block restores the widget", () => {
  const s1 = stateOf(DOC, mathStart + 4);
  const s2 = s1.update({ selection: { anchor: 0 } }).state;
  expect(widgetCount(s2, "MathWidget")).toBe(1);
});

test("a doc change still rebuilds (new table appears)", () => {
  const s1 = stateOf("plain paragraph\n", 0);
  expect(widgetCount(s1, "TableWidget")).toBe(0);
  const table = "\n| a | b |\n| - | - |\n| 1 | 2 |\n";
  const s2 = s1.update({ changes: { from: s1.doc.length, insert: table } }).state;
  expect(widgetCount(s2, "TableWidget")).toBe(1);
});

test("an edit inside an active fence maps unrelated block widgets", () => {
  const doc = "Outside.\n\n```ts\nconst value = 1;\n```\n\n$$\nx^2\n$$\n";
  const edit = doc.indexOf("const");
  const s1 = stateOf(doc, edit);
  const mathBefore = firstWidget(s1, "MathWidget");
  const s2 = s1.update({ changes: { from: edit, to: edit + 1, insert: "A" } }).state;

  expect(mathBefore).toBeDefined();
  expect(firstWidget(s2, "MathWidget")).toBe(mathBefore);
  expect(widgetCount(s2, "CodeBlockWidget")).toBe(0);
});

test("an edit inside an idle fence rebuilds its rendered widget", () => {
  const doc = "Outside.\n\n```ts\nconst value = 1;\n```\n";
  const edit = doc.indexOf("value") + 1;
  const s1 = stateOf(doc, 0);
  const widgetBefore = firstWidget(s1, "CodeBlockWidget");
  const s2 = s1.update({ changes: { from: edit, to: edit + 1, insert: "A" } }).state;

  expect(widgetBefore).toBeDefined();
  expect(firstWidget(s2, "CodeBlockWidget")).not.toBe(widgetBefore);
});
