// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
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
