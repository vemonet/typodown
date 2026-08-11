// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { typodownMarkdown } from "../src/editor.ts";
import { livePreview, quoteDepth } from "../src/live-preview.ts";

function render(doc: string): { parent: HTMLElement; view: EditorView } {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [typodownMarkdown(), livePreview({ html: true })],
    }),
  });
  return { parent, view };
}

/** Rendered lines as `{text, class, style}`, blank separators included. */
function lines(parent: HTMLElement): { text: string; cls: string; style: string }[] {
  return [...parent.querySelectorAll<HTMLElement>(".cm-line")].map((line) => ({
    text: line.textContent ?? "",
    cls: line.className,
    style: line.getAttribute("style") ?? "",
  }));
}

test("counts a line's blockquote nesting depth", () => {
  expect(quoteDepth("> one")).toBe(1);
  expect(quoteDepth("> > two")).toBe(2);
  expect(quoteDepth(">>> three")).toBe(3);
  expect(quoteDepth("  > indented")).toBe(1);
  expect(quoteDepth("no marker")).toBe(0);
});

test("nested blockquotes are decorated once, with their own depth", () => {
  const { parent, view } = render("> outer\n>\n> > inner\n");
  const quoted = lines(parent).filter((l) => l.cls.includes("cm-td-quote"));
  // One `cm-td-quote` per line -- the inner blockquote must not re-decorate the
  // lines its parent already covers (which left them all at the same depth).
  expect(quoted.map((l) => l.cls.split(" ").filter((c) => c === "cm-td-quote").length)).toEqual([
    1, 1, 1,
  ]);
  const inner = quoted.find((l) => l.text.includes("inner"))!;
  expect(inner.style).toContain("--td-quote-depth: 2");
  expect(quoted[0]!.style).not.toContain("--td-quote-depth");
  view.destroy();
  parent.remove();
});

test("hides the quote marker on a nested list line inside an alert", () => {
  const { parent, view } = render("> [!TIP]\n>\n> - first\n>   - nested\n");
  const nested = lines(parent).find((l) => l.text.includes("nested"))!;
  // The `>` used to survive here: the collector only walked two levels deep, so
  // a quote mark sitting under the nested list kept its raw marker.
  expect(nested.text).not.toContain(">");
  view.destroy();
  parent.remove();
});

test("an alert's colour applies to its own level, not to quotes nested in it", () => {
  const { parent, view } = render("> [!WARNING]\n>\n> outer\n>\n> > inner\n");
  const rendered = lines(parent);
  expect(rendered.find((l) => l.text.includes("outer"))!.cls).toContain("cm-td-alert-warning");
  expect(rendered.find((l) => l.text.includes("inner"))!.cls).not.toContain("cm-td-alert");
  view.destroy();
  parent.remove();
});

test("a fenced code block inside a blockquote drops its fence lines and is not re-indented", () => {
  const { parent, view } = render('> [!NOTE]\n>\n> ```sh\n> echo "hi"\n> ```\n');
  const rendered = lines(parent);
  const code = rendered.find((l) => l.text.includes("echo"))!;
  // Both the quote and the code block style the line: the quote keeps its
  // accent and gutter, the code block its fill.
  expect(code.cls).toContain("cm-td-quote");
  expect(code.cls).toContain("cm-td-code");
  // The `> ` marker is the quote's own gutter, not code indentation, so the
  // block must not be shifted right by it.
  expect(code.cls).not.toContain("cm-td-code-indented");
  // Both fence lines are dropped from layout; the opening one used to survive
  // as an empty quoted line, leaving a gap above the block.
  const fences = rendered.filter((l) => l.cls.includes("cm-td-fence-hidden"));
  expect(fences).toHaveLength(2);
  view.destroy();
  parent.remove();
});

test("list indentation inside a blockquote still indents the code block", () => {
  const { parent, view } = render("> - item\n>\n>   ```sh\n>   echo hi\n>   ```\n");
  const code = lines(parent).find((l) => l.text.includes("echo"))!;
  expect(code.cls).toContain("cm-td-code-indented");
  expect(code.style).toContain("--cm-td-code-indent: 2ch");
  view.destroy();
  parent.remove();
});
