// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { typodownMarkdown } from "../src/editor.ts";
import { livePreview, markerEndOnLine } from "../src/live-preview.ts";

test("the space after a bullet / checkbox marker stays in the rendered line", () => {
  const doc = "- item\n- [ ] task\n";
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown(), livePreview({ html: true })],
    }),
  });

  const rendered = [...parent.querySelectorAll<HTMLElement>(".cm-line")].map(
    (line) => line.textContent ?? "",
  );
  // The widgets replace only the marker itself, so the separating space is real
  // text: that gives the caret a position between the bullet / checkbox and the
  // text, instead of sitting hard against the widget until the first keystroke.
  expect(rendered[0]).toBe(" item");
  expect(rendered[1]).toBe(" task");
  expect(parent.querySelector(".cm-td-bullet")).not.toBeNull();
  expect(parent.querySelector(".cm-td-task-box")).not.toBeNull();

  // The caret still cannot land before that space: the hidden-marker end (which
  // the transaction filter clamps to) is past it on both lines.
  const state = view.state;
  expect(markerEndOnLine(state, state.doc.line(1))).toBe(2); // after "- "
  expect(markerEndOnLine(state, state.doc.line(2))).toBe(state.doc.line(2).from + 6); // "- [ ] "

  view.destroy();
  parent.remove();
});
