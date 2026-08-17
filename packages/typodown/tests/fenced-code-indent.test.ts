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

  const codeBlock = parent.querySelector<HTMLElement>(".cm-td-code-widget")!;
  expect(codeBlock.style.marginLeft).toBe("2ch");
  expect(Number.parseFloat(codeBlock.style.height)).toBeCloseTo(102.8);
  expect(codeBlock.style.paddingBlock).toBe("10px");
  expect(codeBlock.querySelector(":scope > .cm-td-copy")).not.toBeNull();
  const copyButton = codeBlock.querySelector<HTMLElement>(":scope > .cm-td-copy")!;
  codeBlock.scrollLeft = 120;
  codeBlock.dispatchEvent(new Event("scroll"));
  expect(copyButton.style.transform).toBe("translateX(120px)");
  expect(codeBlock.textContent).toContain('"answer": 42');
  expect(codeBlock.querySelector(".cm-td-tok-property")?.textContent).toBe('"answer"');

  view.dispatch({ selection: { anchor: doc.indexOf("answer") } });
  const activeCopy = parent.querySelector<HTMLElement>(".cm-td-copy-wrap")!;
  view.scrollDOM.scrollLeft = 80;
  view.scrollDOM.dispatchEvent(new Event("scroll"));
  expect(activeCopy.style.transform).toBe("translateX(80px)");
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
  expect(parent.textContent).not.toContain("```Shell");
  const codeBlocks = [...parent.querySelectorAll<HTMLElement>(".cm-td-code-widget")];
  expect(codeBlocks).toHaveLength(2);
  expect(codeBlocks[0]!.textContent).toContain("brew install rtk");
  const frames = [...parent.querySelectorAll<HTMLElement>(".cm-td-code-widget-frame")];
  expect(frames).toHaveLength(2);
  expect(frames[0]!.querySelector(":scope > .cm-td-code-widget-bullet")).not.toBeNull();
  expect(frames[0]!.querySelector(":scope > .cm-td-code-widget")).toBe(codeBlocks[0]);

  view.destroy();
  parent.remove();
});

test("uses the same marker gutter for top-level unordered and ordered fenced items", () => {
  const doc = [
    "- and a second item, to prove the bullet survives:",
    "",
    "  ```sh",
    '  echo "still a list item"',
    "  ```",
    "",
    "1. ordered item with a fence at 3 spaces:",
    "",
    "   ```py",
    "   def f():",
    '       return "inner indentation preserved"',
    "   ```",
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

  const markerLines = [...parent.querySelectorAll<HTMLElement>(".cm-line")].filter((line) =>
    line.querySelector(".cm-td-list-marker"),
  );
  expect(markerLines).toHaveLength(2);
  expect(markerLines[0]!.querySelector(".cm-td-bullet-shape")).not.toBeNull();
  expect(markerLines[1]!.querySelector(".cm-td-list-mark")?.textContent).toBe("1.");
  expect(parent.querySelectorAll(".cm-td-code-widget")).toHaveLength(2);

  view.destroy();
  parent.remove();
});

test.each([
  ["a wider fence", "before\n\n````javascript\nconst answer = 42\n````", "javascript"],
  [
    "metadata after the language",
    "before\n\n```javascript title=answer.js\nconst answer = 42\n```",
    "javascript",
  ],
])("highlights %s in idle and active code blocks", (_name, doc, language) => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown(), livePreview({ html: true })],
    }),
  });

  expect(parent.querySelector(".cm-td-code-widget .cm-td-tok-keyword")?.textContent).toBe("const");
  expect(parent.querySelector(".cm-td-lang-input")).toBeNull();

  view.dispatch({ selection: { anchor: doc.indexOf("answer") } });
  expect(parent.querySelector(".cm-td-code-widget")).toBeNull();
  expect(parent.querySelector(".cm-line .cm-td-tok-keyword")?.textContent).toBe("const");
  expect(parent.querySelector<HTMLInputElement>(".cm-td-lang-input")?.value).toBe(language);
  expect(view.state.doc.toString()).toBe(doc);

  view.destroy();
  parent.remove();
});

test("the first idle-widget click keeps the clicked code column", () => {
  const doc = "before\n\n```txt\nabcdefghij\n```";
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown(), livePreview({ html: true })],
    }),
  });
  const block = parent.querySelector<HTMLElement>(".cm-td-code-widget")!;
  Object.defineProperty(block, "getBoundingClientRect", {
    value: () => ({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 500,
      bottom: 96,
      width: 400,
      height: 46,
      toJSON: () => ({}),
    }),
  });

  block.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      clientX: 100 + 16 + view.defaultCharacterWidth * 4,
      clientY: 50 + 10 + 5,
    }),
  );
  expect(view.state.selection.main.head).toBe(doc.indexOf("abcdefghij") + 4);

  view.destroy();
  parent.remove();
});

test.each([
  ["a language-free fence with a blank line", "```\n\nstill one code block\n\n```"],
  ["a frontmatter delimiter", "```md\n---\ntype: not-frontmatter\n---\n```"],
  [
    "literal alerts and directives",
    "```md\n> [!NOTE]\n> Not a real alert.\n\n:::tip Not real\n:::\n```",
  ],
  [
    "nested fences used by an outline example",
    "````md\n```md\n# not in the outline\n---\ntype: not-frontmatter\n---\n```\n````",
  ],
  [
    "four nested fence levels",
    "`````md\nOuter\n\n````md\nSecond\n\n```md\nThird\n```\n````\n`````",
  ],
])("keeps content stable across the idle/active transition for %s", (_name, fence) => {
  const doc = `before\n\n${fence}\n`;
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown(), livePreview({ html: true })],
    }),
  });

  const idleBlock = parent.querySelector<HTMLElement>(".cm-td-code-widget")!;
  expect(idleBlock).not.toBeNull();
  const idleText = idleBlock.querySelector("code")!.textContent;

  view.dispatch({ selection: { anchor: doc.indexOf("\n", doc.indexOf("```")) + 1 } });
  const activeLines = [...parent.querySelectorAll<HTMLElement>(".cm-line.cm-td-code")];
  expect(activeLines.map((line) => line.textContent).join("\n")).toBe(idleText);
  expect(parent.querySelector(".cm-td-code-widget")).toBeNull();

  view.destroy();
  parent.remove();
});
