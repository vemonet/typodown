// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { Typodown } from "../src/editor.ts";

/** Mount an editor with the caret at the end of a single-line document. */
function mount(value: string, tabSize?: number) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new Typodown(parent, { value, tabSize });
  const content = parent.querySelector<HTMLElement>(".cm-content")!;
  const tab = (shift = false): void => {
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  const cleanup = (): void => {
    editor.destroy();
    parent.remove();
  };
  return { editor, tab, cleanup };
}

test("Tab indents by four spaces by default", () => {
  const { editor, tab, cleanup } = mount("- item");
  tab();
  expect(editor.getValue()).toBe("    - item");
  tab(true);
  expect(editor.getValue()).toBe("- item");
  cleanup();
});

test("tabSize sets the indent width", () => {
  const { editor, tab, cleanup } = mount("- item", 2);
  tab();
  expect(editor.getValue()).toBe("  - item");
  tab();
  expect(editor.getValue()).toBe("    - item");
  tab(true);
  expect(editor.getValue()).toBe("  - item");
  cleanup();
});

test("setTabSize changes the width of later indents", () => {
  const { editor, tab, cleanup } = mount("- item", 2);
  tab();
  editor.setTabSize(8);
  tab();
  expect(editor.getValue()).toBe("          - item");
  cleanup();
});

test("a nonsensical tabSize falls back to the default", () => {
  const { editor, tab, cleanup } = mount("- item", 0);
  tab();
  expect(editor.getValue()).toBe("    - item");
  cleanup();
});
