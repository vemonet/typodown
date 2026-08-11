// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { selectCodeContent, typodownMarkdown } from "../src/editor.ts";
import { livePreview } from "../src/live-preview.ts";

test("indents a fenced code block nested in a list instead of its code", () => {
  const doc = '- item\n\n  ```json\n  {\n    "answer": 42\n  }\n  ```\n';
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown(), livePreview({ html: true })],
    }),
  });

  const codeLines = [...parent.querySelectorAll<HTMLElement>(".cm-td-code")];
  expect(codeLines).toHaveLength(3);
  for (const line of codeLines) {
    expect(line.classList.contains("cm-td-code-indented")).toBe(true);
    expect(line.style.getPropertyValue("--cm-td-code-indent")).toBe("2ch");
  }
  expect(codeLines.map((line) => line.textContent)).toEqual(["{", '  "answer": 42', "}"]);
  expect(parent.querySelector(".cm-td-tok-property")?.textContent).toBe('"answer"');

  view.dispatch({ selection: { anchor: doc.indexOf("answer") } });
  expect(selectCodeContent(view)).toBe(true);
  const selected = view.state.sliceDoc(
    view.state.selection.main.from,
    view.state.selection.main.to,
  );
  expect(selected).toBe('{\n    "answer": 42\n  }');

  view.destroy();
  parent.remove();
});

test("keeps bullets for list items containing fenced code blocks", () => {
  const doc = [
    "- [`rtk`](https://github.com/rtk-ai/rtk) to reduce tools token usage",
    "",
    "- ```Shell",
    "  brew install rtk",
    "  ```",
    "",
    "- ```Shell",
    "  rtk init -g",
    "  ```",
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

  expect(parent.querySelectorAll(".cm-td-bullet")).toHaveLength(3);
  expect(parent.querySelectorAll(".cm-line.cm-td-fence-hidden")).toHaveLength(2);
  expect(parent.textContent).not.toContain("```Shell");

  view.destroy();
  parent.remove();
});
