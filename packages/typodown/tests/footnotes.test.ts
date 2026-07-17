import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { typodownMarkdown } from "../src/editor.ts";
import { parseFootnoteDefinition } from "../src/live-preview.ts";

test("footnote references are parsed as shortcut links", () => {
  const state = EditorState.create({
    doc: "A statement[^note].\n\n[^note]: Supporting detail.",
    extensions: [typodownMarkdown()],
  });
  const links: string[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Link") links.push(state.doc.sliceString(node.from, node.to));
    },
  });
  expect(links).toContain("[^note]");
});

test("parses a footnote definition marker and its spacing", () => {
  expect(parseFootnoteDefinition("[^note]: Supporting detail.")).toEqual({
    label: "note",
    markerLength: 9,
  });
  expect(parseFootnoteDefinition("  [^2]:\tDetail")).toEqual({ label: "2", markerLength: 8 });
});

test("rejects malformed and overly indented definitions", () => {
  expect(parseFootnoteDefinition("[note]: Not a footnote")).toBeNull();
  expect(parseFootnoteDefinition("    [^note]: Code, not a definition")).toBeNull();
  expect(parseFootnoteDefinition("[^bad label]: Detail")).toBeNull();
});
