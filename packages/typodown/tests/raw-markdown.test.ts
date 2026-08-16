// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import type { EditorView } from "@codemirror/view";
import { Typodown } from "../src/editor.ts";

test("Mod+/ toggles rendered and raw Markdown", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, { value: "# Heading\n\n**bold**" });

  expect(parent.querySelector(".cm-td-heading")).not.toBeNull();
  expect(editor.isRawMarkdown()).toBe(false);

  const content = parent.querySelector<HTMLElement>(".cm-content")!;
  content.dispatchEvent(
    new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }),
  );

  expect(editor.isRawMarkdown()).toBe(true);
  expect(editor.wrapper.hasAttribute("data-td-raw")).toBe(true);
  expect(parent.querySelector(".cm-td-heading")).toBeNull();
  expect(content.textContent).toContain("# Heading");

  content.dispatchEvent(
    new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }),
  );
  expect(editor.isRawMarkdown()).toBe(false);
  expect(parent.querySelector(".cm-td-heading")).not.toBeNull();

  editor.destroy();
  parent.remove();
});

test("collapsed separators preserve heading and paragraph styling", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, {
    value: "First paragraph.\n\n## Heading\n\nSecond paragraph.",
  });

  const heading = parent.querySelector<HTMLElement>(".cm-td-heading")!;
  expect(heading.textContent).toBe("Heading");
  expect(heading.classList).toContain("cm-td-h2");
  expect(parent.querySelector<HTMLElement>(".cm-td-heading-gap")?.style.height).toBe("22px");
  expect(parent.querySelector(".cm-td-paragraph-gap")).not.toBeNull();

  editor.destroy();
  parent.remove();
});

test("a single paragraph separator stays layout-only when selected", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, { value: "Par1\n\nPar2" });
  const view = (editor as unknown as { view: EditorView }).view;

  view.dispatch({ selection: { anchor: 5 } });
  expect(view.state.selection.main.head).toBe(6);
  expect(parent.querySelector(".cm-td-paragraph-gap")).not.toBeNull();
  expect([...parent.querySelectorAll(".cm-line")].some((line) => line.textContent === "")).toBe(
    false,
  );

  editor.destroy();
  parent.remove();
});

test("the separator before a heading owns the heading margin", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, { value: "Par1\n\n# Heading" });
  const view = (editor as unknown as { view: EditorView }).view;

  view.dispatch({ selection: { anchor: 5 } });
  expect(view.state.selection.main.head).toBe(6);
  expect(parent.querySelectorAll(".cm-td-heading-gap")).toHaveLength(1);
  expect([...parent.querySelectorAll(".cm-line")].some((line) => line.textContent === "")).toBe(
    false,
  );

  editor.destroy();
  parent.remove();
});

test("visible heading markers inherit the heading size", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, { value: "# Large heading" });

  const marker = parent.querySelector<HTMLElement>(".cm-td-mark")!;
  expect(marker.textContent).toContain("#");
  expect(marker.classList).toContain("cm-td-heading");
  expect(marker.classList).toContain("cm-td-h1");

  editor.destroy();
  parent.remove();
});

test("heading style follows typing immediately at every ATX level", () => {
  for (let level = 1; level <= 6; level++) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const prefix = `${"#".repeat(level)} `;
    const editor = new Typodown(parent, { value: prefix });
    const view = (editor as unknown as { view: EditorView }).view;

    for (const character of "Heading") {
      view.dispatch({ changes: { from: view.state.doc.length, insert: character } });
      expect(
        parent.querySelector<HTMLElement>(".cm-td-heading:not(.cm-td-mark)")?.textContent,
      ).toBe(view.state.doc.sliceString(prefix.length));
    }

    editor.destroy();
    parent.remove();
  }
});

test("a heading at the document start does not render a synthetic line above it", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, { value: "# Heading" });

  expect(parent.querySelector(".cm-td-heading-gap")).toBeNull();
  const lines = [...parent.querySelectorAll<HTMLElement>(".cm-line")];
  expect(lines).toHaveLength(1);
  expect(lines[0]!.textContent).toContain("Heading");

  editor.destroy();
  parent.remove();
});

test("the first heading has extra separation after frontmatter", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, {
    value: "---\ntitle: Test\n---\n\n# Heading",
  });

  expect(parent.querySelector<HTMLElement>(".cm-td-heading-gap")?.style.height).toBe("32px");

  editor.destroy();
  parent.remove();
});

test("uses CodeMirror's geometry-backed caret layer", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, {
    value: "before\n\n```ts\nconst first = 1;\n```",
  });

  expect(parent.querySelector(".cm-cursorLayer")).not.toBeNull();

  editor.destroy();
  parent.remove();
});
