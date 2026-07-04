import { expect, test } from "vite-plus/test";
import type { Inline } from "../src/ast.ts";
import { parseInline } from "../src/inline.ts";
import { parse } from "../src/parse.ts";

// The core invariant the editor relies on: block source ranges tile the whole
// document with no gaps or overlaps.
function assertTiled(value: string): void {
  const blocks = parse(value);
  expect(blocks[0]!.from).toBe(0);
  expect(blocks.at(-1)!.to).toBe(value.length);
  for (let i = 1; i < blocks.length; i++) {
    expect(blocks[i]!.from).toBe(blocks[i - 1]!.to);
  }
}

// Inline nodes must likewise cover their range contiguously.
function inlineLeaves(nodes: Inline[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const n of nodes) {
    if ("children" in n) out.push(...inlineLeaves(n.children));
    else out.push({ from: n.from, to: n.to });
  }
  return out;
}

function assertInlineCovers(src: string): void {
  const leaves = inlineLeaves(parseInline(src, 0, src.length)).sort((a, b) => a.from - b.from);
  let cursor = 0;
  for (const leaf of leaves) {
    expect(leaf.from).toBe(cursor);
    cursor = leaf.to;
  }
  expect(cursor).toBe(src.length);
}

test("block ranges tile the document", () => {
  assertTiled("# Title\n\nA paragraph with **bold**.\n\n- one\n- two\n");
  assertTiled("```ts\nconst x = 1;\n```\n\n> quote\n");
  assertTiled("");
  assertTiled("no trailing newline");
  assertTiled("line1\nline2\n\n\npara2");
});

test("headings", () => {
  const [h] = parse("### Hello");
  expect(h!.type).toBe("heading");
  if (h!.type === "heading") expect(h!.level).toBe(3);
});

test("GFM alert detection", () => {
  const [bq] = parse("> [!NOTE]\n> body\n");
  expect(bq!.type).toBe("blockquote");
  if (bq!.type === "blockquote") expect(bq!.alert).toBe("note");
});

test("task list items", () => {
  const [list] = parse("- [x] done\n- [ ] todo\n");
  expect(list!.type).toBe("list");
  if (list!.type === "list") {
    expect(list!.items[0]!.checked).toBe(true);
    expect(list!.items[1]!.checked).toBe(false);
  }
});

test("list items absorb soft-wrapped continuation lines", () => {
  const blocks = parse("- first item\n  continues here\n- second item");
  expect(blocks.length).toBe(1);
  const [list] = blocks;
  expect(list!.type).toBe("list");
  if (list!.type === "list") {
    expect(list!.items.length).toBe(2);
    const text = list!.items[0]!.inline.map((n) => ("text" in n ? n.text : "")).join("");
    expect(text).toContain("first item");
    expect(text).toContain("continues here");
  }
});

test("nested list items record indent and marker type", () => {
  const [list] = parse("- a\n  - b\n    1. c\n- d");
  expect(list!.type).toBe("list");
  if (list!.type === "list") {
    expect(list!.items.map((i) => i.indent)).toEqual([0, 2, 4, 0]);
    expect(list!.items.map((i) => i.ordered)).toEqual([false, false, true, false]);
  }
});

test("fenced code captures language", () => {
  const [code] = parse("```js\nalert(1)\n```\n");
  expect(code!.type).toBe("code");
  if (code!.type === "code") expect(code!.lang).toBe("js");
});

test("tables", () => {
  const [table] = parse("| a | b |\n| :- | -: |\n| 1 | 2 |\n");
  expect(table!.type).toBe("table");
  if (table!.type === "table") {
    expect(table!.header).toEqual(["a", "b"]);
    expect(table!.align).toEqual(["left", "right"]);
    expect(table!.rows).toEqual([["1", "2"]]);
  }
});

test("inline coverage is total", () => {
  assertInlineCovers("plain text");
  assertInlineCovers("a **bold** and *em* and `code` word");
  assertInlineCovers("link [text](https://example.com) here");
  assertInlineCovers("nested ***both*** and ~~strike~~");
  assertInlineCovers("escape \\* not emphasis");
  assertInlineCovers("image ![alt](img.png) inline");
});

test("emphasis parses to the right tags", () => {
  const nodes = parseInline("**b** *i* ~~s~~", 0, 15);
  const tags = nodes.filter((n) => n.type === "emph").map((n) => (n.type === "emph" ? n.tag : ""));
  expect(tags).toEqual(["strong", "em", "del"]);
});

test("underscore inside a word is literal", () => {
  const nodes = parseInline("foo_bar_baz", 0, 11);
  expect(nodes.every((n) => n.type !== "emph")).toBe(true);
});

test("html blocks are detected by default", () => {
  const [blk] = parse("<div>\nhello\n</div>\n");
  expect(blk!.type).toBe("html");
  const [comment] = parse("<!-- comment -->\n");
  expect(comment!.type).toBe("html");
  const [pre] = parse("<pre>x</pre>\n");
  expect(pre!.type).toBe("html");
});

test("html blocks can be disabled", () => {
  const [blk] = parse("<div>\nhello\n</div>\n", false);
  expect(blk!.type).not.toBe("html");
});

test("inline html is detected by default", () => {
  const nodes = parseInline("a <kbd>b</kbd> c", 0, 16);
  const html = nodes.filter((n) => n.type === "html");
  expect(html.length).toBe(2);
  expect(html[0]!.type === "html" && html[0]!.raw).toBe("<kbd>");
  expect(html[1]!.type === "html" && html[1]!.raw).toBe("</kbd>");
});

test("inline html can be disabled", () => {
  const nodes = parseInline("a <kbd>b</kbd> c", 0, 16, false);
  expect(nodes.every((n) => n.type !== "html")).toBe(true);
});

test("html inline coverage is total", () => {
  assertInlineCovers("a <kbd>b</kbd> c");
  assertInlineCovers("<span style='color:red'>x</span>");
  assertInlineCovers("text <!-- comment --> more");
});

// An autolink starting a line looks superficially like a tag, but its `://` is
// not valid tag syntax, so it must not be swallowed as an HTML block.
test("autolinks are not mistaken for html blocks", () => {
  const [blk] = parse("<https://viteplus.dev>\n");
  expect(blk!.type).toBe("paragraph");
  const [mail] = parse("<hello@example.com>\n");
  expect(mail!.type).toBe("paragraph");
});

test("a wrapped paragraph starting with an autolink stays one paragraph", () => {
  const src = "text and\n<https://viteplus.dev> more\ntail";
  const blocks = parse(src);
  expect(blocks.length).toBe(1);
  expect(blocks[0]!.type).toBe("paragraph");
  expect(blocks.some((b) => b.type === "html")).toBe(false);
  assertTiled(src);
});

// A block-level tag with a trailing description is HTML block type 6, while a
// bare complete tag on its own line is type 7; both render as html blocks.
test("html block types 6 and 7", () => {
  const [six] = parse("<section>\nbody\n</section>\n");
  expect(six!.type).toBe("html");
  const [seven] = parse('<abbr title="x">\n');
  expect(seven!.type).toBe("html");
});
