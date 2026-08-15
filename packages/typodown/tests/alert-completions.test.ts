import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { alertCompletions, typodownMarkdown } from "../src/editor.ts";

function complete(docWithCaret: string) {
  const pos = docWithCaret.indexOf("|");
  const doc = docWithCaret.slice(0, pos) + docWithCaret.slice(pos + 1);
  const state = EditorState.create({ doc, extensions: [typodownMarkdown()] });
  return alertCompletions(new CompletionContext(state, pos, false));
}

test("alert completion adds a missing closing bracket", () => {
  const result = complete("> [!TI|");
  expect(result?.options.find((option) => option.label === "TIP")?.apply).toBe("TIP]");
});

test("alert completion reuses an existing closing bracket", () => {
  const result = complete("> [!|]");
  expect(result?.options.find((option) => option.label === "TIP")?.apply).toBe("TIP");
});
