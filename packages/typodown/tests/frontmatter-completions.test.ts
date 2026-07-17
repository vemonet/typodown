import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { typodownMarkdown, frontMatterCompletions } from "../src/editor.ts";

/** Run the front matter completion source on `doc` with the caret at the
 * marker `|` (removed from the document). */
function complete(docWithCaret: string, explicit = false) {
  const pos = docWithCaret.indexOf("|");
  const doc = docWithCaret.slice(0, pos) + docWithCaret.slice(pos + 1);
  const state = EditorState.create({ doc, extensions: [typodownMarkdown()] });
  return frontMatterCompletions(new CompletionContext(state, pos, explicit));
}

function labels(result: ReturnType<typeof complete>): string[] {
  return (result?.options ?? []).map((o) => o.label);
}

test("suggests field names while typing a key", () => {
  const result = complete("---\nti|\n---\ncontent\n");
  expect(labels(result)).toContain("title");
  expect(labels(result)).toContain("type");
});

test("field names complete with a trailing colon-space", () => {
  const result = complete("---\nti|\n---\n");
  const title = result?.options.find((o) => o.label === "title");
  expect(title?.apply).toBe("title: ");
});

test("does not re-suggest keys already present in the block", () => {
  const result = complete("---\ntitle: My note\nt|\n---\n");
  expect(labels(result)).not.toContain("title");
  expect(labels(result)).toContain("type");
});

test("blank line stays quiet unless explicitly invoked", () => {
  expect(complete("---\n|\n---\n")).toBeNull();
  expect(labels(complete("---\n|\n---\n", true))).toContain("title");
});

test("suggests OKF resource types as values for the type field", () => {
  const result = complete("---\ntype: Vi|\n---\n");
  expect(labels(result)).toContain("Article");
});

test("no completions outside the front matter block", () => {
  expect(complete("---\ntitle: x\n---\nti|\n")).toBeNull();
  expect(complete("no front matter\nti|\n")).toBeNull();
});

test("no field completions after a key's colon (except type values)", () => {
  expect(complete("---\ntitle: My no|\n---\n")).toBeNull();
});
