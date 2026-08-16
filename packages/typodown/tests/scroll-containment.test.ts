// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { Typodown } from "../src/editor.ts";

test("the editor owns scrolling without trapping sticky controls", () => {
  const parent = document.createElement("div");
  parent.style.height = "400px";
  document.body.append(parent);
  const editor = new Typodown(parent, { value: "# Heading\n\n".repeat(100) });
  const scroller = editor.wrapper.querySelector<HTMLElement>(".cm-scroller")!;

  expect(editor.wrapper.style.overflow).toBe("clip");
  expect(editor.wrapper.style.minHeight).toBe("0px");
  expect(scroller.style.overflowY).toBe("auto");

  editor.destroy();
  parent.remove();
});
