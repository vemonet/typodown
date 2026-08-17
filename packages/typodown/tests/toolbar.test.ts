// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { createToolbar, defaultToolbarActions } from "../src/toolbar.ts";

function mount(save?: { run: () => void; isDirty?: () => boolean }): {
  wrapper: HTMLElement;
  view: EditorView;
  handle: ReturnType<typeof createToolbar>;
} {
  const wrapper = document.createElement("div");
  wrapper.className = "typodown";
  document.body.append(wrapper);
  const view = new EditorView({
    parent: wrapper,
    state: EditorState.create({ doc: "hello", extensions: [history()] }),
  });
  let raw = false;
  const handle = createToolbar(wrapper, view, {
    mode: "shown",
    actions: defaultToolbarActions({
      wrapMarker: () => () => {},
      insertLink: () => {},
      toggleTask: () => {},
      openTable: () => {},
    }),
    save,
    openSearch: () => {},
    rawMarkdown: {
      toggle: () => {
        raw = !raw;
      },
      isRaw: () => raw,
    },
    toggleOutline: () => {},
  });
  return { wrapper, view, handle };
}

function buttons(wrapper: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  for (const btn of wrapper.querySelectorAll<HTMLButtonElement>(".cm-td-toolbar-btn")) {
    out[btn.getAttribute("aria-label")!] = btn;
  }
  return out;
}

test("renders history, formatting, utility and toggle groups", () => {
  const { wrapper, view, handle } = mount();
  const labels = [...wrapper.querySelectorAll(".cm-td-toolbar-btn")].map((b) =>
    b.getAttribute("aria-label"),
  );
  expect(labels).toEqual([
    "Undo",
    "Redo",
    "Bold",
    "Italic",
    "Strikethrough",
    "Inline code",
    "Link",
    "Checkbox",
    "Add table",
    "Find",
    "Raw Markdown",
    "Toggle outline",
    "Hide toolbar",
  ]);
  // One separator between each pair of groups.
  expect(wrapper.querySelectorAll(".cm-td-toolbar-sep")).toHaveLength(3);
  handle.destroy();
  view.destroy();
  wrapper.remove();
});

test("reveals a show button while the toolbar is hidden", () => {
  const { wrapper, view, handle } = mount();
  const bar = wrapper.querySelector<HTMLElement>(".cm-td-toolbar")!;
  const show = wrapper.querySelector<HTMLButtonElement>(".cm-td-toolbar-show")!;

  buttons(wrapper)["Hide toolbar"]!.click();
  expect(bar.style.display).toBe("none");
  expect(show.style.display).toBe("");

  show.click();
  expect(bar.style.display).toBe("");
  expect(show.style.display).toBe("none");

  handle.destroy();
  view.destroy();
  wrapper.remove();
});

test("undo and redo track the history depth", () => {
  const { wrapper, view, handle } = mount();
  const { Undo, Redo } = buttons(wrapper);
  expect(Undo!.disabled).toBe(true);
  expect(Redo!.disabled).toBe(true);

  view.dispatch({ changes: { from: 5, insert: "!" }, userEvent: "input" });
  handle.refresh();
  expect(Undo!.disabled).toBe(false);
  expect(Redo!.disabled).toBe(true);

  Undo!.dispatchEvent(new MouseEvent("click"));
  expect(view.state.doc.toString()).toBe("hello");
  expect(Undo!.disabled).toBe(true);
  expect(Redo!.disabled).toBe(false);

  Redo!.dispatchEvent(new MouseEvent("click"));
  expect(view.state.doc.toString()).toBe("hello!");
  handle.destroy();
  view.destroy();
  wrapper.remove();
});

test("the raw Markdown button reads as pressed while the mode is on", () => {
  const { wrapper, view, handle } = mount();
  const raw = buttons(wrapper)["Raw Markdown"]!;
  expect(raw.getAttribute("aria-pressed")).toBe("false");
  raw.dispatchEvent(new MouseEvent("click"));
  expect(raw.getAttribute("aria-pressed")).toBe("true");
  raw.dispatchEvent(new MouseEvent("click"));
  expect(raw.getAttribute("aria-pressed")).toBe("false");
  handle.destroy();
  view.destroy();
  wrapper.remove();
});

test("Save is disabled while clean, and latched off until the next edit", () => {
  let dirty = false;
  let saves = 0;
  const { wrapper, view, handle } = mount({
    run: () => saves++,
    isDirty: () => dirty,
  });
  const save = buttons(wrapper).Save!;
  expect(save.disabled).toBe(true);

  dirty = true;
  handle.refresh();
  expect(save.disabled).toBe(false);

  save.dispatchEvent(new MouseEvent("click"));
  expect(saves).toBe(1);
  // Still dirty as far as the host knows (the write is async), but the button is
  // latched so a double-tap can't queue a second save.
  expect(save.disabled).toBe(true);
  save.dispatchEvent(new MouseEvent("click"));
  expect(saves).toBe(1);

  handle.refresh(); // stands in for the next document change
  expect(save.disabled).toBe(false);
  handle.destroy();
  view.destroy();
  wrapper.remove();
});

test("hovering a button shows our own tooltip with the shortcut", () => {
  const { wrapper, view, handle } = mount();
  const tip = wrapper.querySelector<HTMLElement>(".cm-td-toolbar-tip")!;
  expect(tip.hidden).toBe(true);
  const bold = buttons(wrapper).Bold!;
  bold.dispatchEvent(new Event("pointerenter"));
  expect(tip.hidden).toBe(false);
  expect(tip.textContent).toMatch(/^Bold \((⌘|Ctrl)\+B\)$/);
  bold.dispatchEvent(new Event("pointerleave"));
  expect(tip.hidden).toBe(true);
  handle.destroy();
  view.destroy();
  wrapper.remove();
});
