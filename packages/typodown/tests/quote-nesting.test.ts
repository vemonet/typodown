// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { normalizeQuoteMarkerSpaces, typodownMarkdown } from "../src/editor.ts";
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
    1, 1,
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

test("keeps the alert accent on its title line", () => {
  const { parent, view } = render("> [!TIP]\n> Helpful text\n");
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  const title = parent.querySelector<HTMLElement>(".cm-td-alert-title")!;
  expect(title.dataset.label).toBe("Tip");
  expect(title.closest(".cm-line")).not.toBeNull();

  view.destroy();
  parent.remove();
});

test("an alert's colour applies to its own level, not to quotes nested in it", () => {
  const { parent, view } = render("> [!WARNING]\n>\n> outer\n>\n> > inner\n");
  const rendered = lines(parent);
  expect(rendered.find((l) => l.text.includes("outer"))!.cls).toContain("cm-td-alert-warning");
  const inner = rendered.find((l) => l.text.includes("inner"))!;
  expect(inner.cls).not.toContain("cm-td-alert");
  expect(inner.style).toContain("--td-quote-outer-color: var(--td-warning)");
  view.destroy();
  parent.remove();
});

test("nested fences keep every parent quote gutter", () => {
  const { parent, view } = render(
    "> outer\n> > inner\n> > ```js\n> > const nested = true\n> > ```\n",
  );
  const code = lines(parent).find((line) => line.text.includes("const nested"))!;
  expect(code.cls).toContain("cm-td-code");
  expect(code.cls).toContain("cm-td-quote");
  expect(code.style).toContain("--td-quote-depth: 2");

  view.destroy();
  parent.remove();
});

test("a fenced code block inside a blockquote keeps the quote decoration in both states", () => {
  const { parent, view } = render('> [!NOTE]\n>\n> ```sh\n> echo "hi"\n> ```\n');
  expect(parent.querySelector(".cm-td-code-widget")).toBeNull();
  let code = lines(parent).find((line) => line.text.includes('echo "hi"'))!;
  expect(code.cls).toContain("cm-td-code");
  expect(code.cls).toContain("cm-td-quote");
  expect(code.cls).toContain("cm-td-alert-note");

  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("echo") } });
  code = lines(parent).find((line) => line.text.includes('echo "hi"'))!;
  expect(code.cls).toContain("cm-td-code");
  expect(code.cls).toContain("cm-td-quote");
  expect(code.cls).toContain("cm-td-alert-note");
  view.destroy();
  parent.remove();
});

test("list indentation inside a blockquote still indents the code block", () => {
  const { parent, view } = render("> - item\n>\n>   ```sh\n>   echo hi\n>   ```\n");
  const code = lines(parent).find((line) => line.text.includes("echo hi"))!;
  expect(code.cls).toContain("cm-td-code");
  expect(code.cls).toContain("cm-td-quote");
  expect(code.style).toContain("--cm-td-code-indent: 2ch");
  view.destroy();
  parent.remove();
});

test("no-break spaces in quote prefixes still produce alerts and fenced code", () => {
  const nbsp = "\u00a0";
  const source = [
    `>${nbsp}[!WARNING]`,
    `>${nbsp}`,
    `>${nbsp}copied${nbsp}prose`,
    `>${nbsp}`,
    `>${nbsp}\`\`\`sh`,
    `>${nbsp}echo${nbsp}hello`,
    `>${nbsp}\`\`\``,
  ].join("\n");
  const normalized = normalizeQuoteMarkerSpaces(source);
  expect(normalized).toContain("> [!WARNING]");
  expect(normalized).toContain(`> copied${nbsp}prose`);

  const { parent, view } = render(normalized);
  const code = lines(parent).find((line) => line.text.includes(`echo${nbsp}hello`))!;
  expect(code.cls).toContain("cm-td-code");
  expect(code.cls).toContain("cm-td-quote");
  expect(lines(parent).filter((line) => line.cls.includes("cm-td-fence-hidden"))).toHaveLength(0);
  view.destroy();
  parent.remove();
});

test("keeps the directive opening when its blank separator is collapsed", () => {
  const { parent, view } = render(":::warning\nfirst\n\nsecond\n:::\n");
  const rendered = lines(parent);
  const opening = rendered.find(
    (line) => line.cls.includes("cm-td-directive") && !line.cls.includes("cm-td-directive-content"),
  )!;
  expect(opening.cls).toContain("cm-td-directive");
  expect(opening.cls).not.toContain("cm-td-directive-content");
  expect(rendered.some((line) => line.text.includes("second"))).toBe(true);
  view.destroy();
  parent.remove();
});

test("nested blocks keep a directive's decoration while idle", () => {
  const source = [
    ":::warning Directive with a label wrapping other blocks",
    "A directive container holding a list, a quote and a fence:",
    "",
    "- one",
    "- two",
    "",
    "> quoted inside a directive",
    "",
    "```sh",
    'echo "fence inside a directive"',
    "```",
    "",
    ":::",
  ].join("\n");
  const { parent, view } = render(source);
  view.dispatch({ selection: { anchor: source.length } });

  expect(parent.querySelector(".cm-td-code-widget")).toBeNull();
  const gaps = [...parent.querySelectorAll<HTMLElement>(".cm-td-directive-gap")];
  expect(gaps.length).toBeGreaterThan(0);
  expect(gaps.every((gap) => gap.classList.contains("cm-td-alert-warning"))).toBe(true);
  for (const text of ["one", "quoted inside a directive", "fence inside a directive"]) {
    const line = lines(parent).find((candidate) =>
      text === "one" ? candidate.text.trim() === text : candidate.text.includes(text),
    )!;
    expect(line.cls, text).toContain("cm-td-directive-content");
    expect(line.cls, text).toContain("cm-td-alert-warning");
  }
  const fence = lines(parent).find((line) => line.text.includes("fence inside a directive"))!;
  expect(fence.cls).toContain("cm-td-code");

  view.destroy();
  parent.remove();
});
