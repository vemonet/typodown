// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { typodownMarkdown } from "../src/editor.ts";
import { livePreview } from "../src/live-preview.ts";

test("keeps inline and block HTML comments visible but dimmed", () => {
  const doc = [
    "Visible <!-- inline comment --> text",
    "",
    "<!--",
    "# Commented-out heading",
    "- Commented-out item",
    "-->",
  ].join("\n");
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown(), livePreview({ html: true })],
    }),
  });

  const comments = [...parent.querySelectorAll<HTMLElement>(".cm-td-comment")];
  expect(comments.map((comment) => comment.textContent).join("")).toContain(
    "<!-- inline comment -->",
  );
  expect(comments.map((comment) => comment.textContent).join("")).toContain(
    "# Commented-out heading",
  );
  expect(parent.textContent).toContain("- Commented-out item");

  view.destroy();
  parent.remove();
});
