import { expect, test } from "vite-plus/test";
import type { Block, Inline } from "../src/ast.ts";
import { parse } from "../src/parse.ts";

// A corpus of inputs covering every section of the CommonMark spec, plus the
// GFM extensions we support. We do NOT claim byte-for-byte CommonMark HTML
// output (this editor renders a Typora-style DOM, not canonical HTML). What we
// DO guarantee for *any* input is the invariant the editor's caret depends on:
// block source ranges tile the whole document with no gaps or overlaps, and
// inline ranges tile their block. These tests feed the whole corpus through the
// parser and assert that invariant holds (and that parsing never throws).

const CORPUS: Record<string, string[]> = {
  "thematic breaks": ["***", "---", "___", "- - -", "***\n---\n___"],
  "atx headings": ["# h1", "###### h6", "####### not a heading", "#no", "## h ##"],
  "setext headings": ["Foo\n===", "Foo\n---", "Foo\nBar\n==="],
  "indented code": ["    a code block", "    line1\n    line2"],
  "fenced code": ["```\ncode\n```", "~~~\ncode\n~~~", "```ruby\nputs 1\n```", "```\nunclosed"],
  "html blocks": ["<div>\nhi\n</div>", "<!-- comment -->", "<pre>x</pre>"],
  "link reference definitions": ["[foo]: /url\n\n[foo]", '[a]: /b "title"\n\nsee [a]'],
  paragraphs: ["aaa\n\nbbb", "aaa\nbbb", "  leading spaces"],
  "blank lines": ["\n\n\naaa\n\n\n", "aaa\n\n\n\nbbb"],
  "block quotes": ["> foo", "> foo\n> bar", "> > nested", ">no space", "> [!NOTE]\n> body"],
  "list items": ["- one", "1. one", "1) one", "3. starts at three", "- [ ] task\n- [x] done"],
  lists: [
    "- a\n- b\n- c",
    "1. a\n2. b",
    "- a\n  - b\n    - c",
    "- a\n\n- b",
    "- a\n  1. nested ordered\n- b",
  ],
  "backslash escapes": ["\\*not emphasis\\*", "\\`code\\`", "a\\\nb"],
  "entity references": ["&amp; &#35; &copy;", "&notreal;"],
  "code spans": ["`foo`", "``foo`bar``", "`` ` ``", "`unterminated"],
  emphasis: [
    "*em* _em_",
    "**strong** __strong__",
    "***both***",
    "~~strike~~",
    "a*b*c",
    "foo_bar_baz",
    "**a *b* c**",
  ],
  links: ["[a](/b)", '[a](/b "t")', "[a][ref]", "[nested [b](/c) d](/e)", "[unclosed"],
  images: ["![alt](/img.png)", '![a](/b "t")', "![](/x)"],
  autolinks: ["<http://example.com>", "<foo@bar.com>", "<not a link>"],
  "raw html": ["foo <bar> baz", "<a href='x'>y</a>", "a <br/> b"],
  "hard breaks": ["foo  \nbar", "foo\\\nbar"],
  "soft breaks": ["foo\nbar", "foo \n baz"],
  tables: ["| a | b |\n| - | - |\n| 1 | 2 |", "| x |\n|:-:|\n| y |"],
  mixed: [
    "# Title\n\nPara with **bold**.\n\n- list\n\n> quote\n\n```\ncode\n```\n\n| a |\n|-|\n|1|",
    "",
    "\n",
    "no trailing newline",
    "trailing newline\n",
  ],
};

function assertTiled(md: string): void {
  const blocks = parse(md);
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks[0]!.from).toBe(0);
  expect(blocks.at(-1)!.to).toBe(md.length);
  for (let i = 1; i < blocks.length; i++) {
    expect(blocks[i]!.from).toBe(blocks[i - 1]!.to);
    expect(blocks[i]!.from).toBeLessThanOrEqual(blocks[i]!.to);
  }
}

function inlineLeaves(nodes: Inline[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const n of nodes) {
    if ("children" in n) out.push(...inlineLeaves(n.children));
    else out.push({ from: n.from, to: n.to });
  }
  return out;
}

// Within a block, the inline nodes it carries must themselves tile contiguously.
function assertInlineTiled(md: string): void {
  const walk = (nodes: Inline[]): void => {
    const leaves = inlineLeaves(nodes).sort((a, b) => a.from - b.from);
    for (let i = 1; i < leaves.length; i++) {
      expect(leaves[i]!.from).toBe(leaves[i - 1]!.to);
    }
  };
  for (const b of parse(md)) {
    if (b.type === "paragraph" || b.type === "heading") walk(b.inline);
    if (b.type === "blockquote") for (const l of b.lines) walk(l.inline);
    if (b.type === "list") for (const it of b.items) walk(it.inline);
  }
}

for (const [section, cases] of Object.entries(CORPUS)) {
  test(`block ranges tile the document: ${section}`, () => {
    for (const md of cases) {
      expect(() => parse(md), md).not.toThrow();
      assertTiled(md);
      assertInlineTiled(md);
    }
  });
}

// A larger fuzz-style concatenation: every case joined together must still tile.
test("tiling holds for the whole corpus concatenated", () => {
  const all = Object.values(CORPUS).flat().join("\n\n");
  assertTiled(all);
  assertInlineTiled(all);
});

// Spot-checks for the features we DO fully support (documents intended behaviour).
test("supported constructs produce the expected block types", () => {
  const type = (md: string): Block["type"] => parse(md)[0]!.type;
  expect(type("# h")).toBe("heading");
  expect(type("> q")).toBe("blockquote");
  expect(type("- a")).toBe("list");
  expect(type("1. a")).toBe("list");
  expect(type("```\nx\n```")).toBe("code");
  expect(type("---")).toBe("hr");
  expect(type("| a |\n| - |\n| 1 |")).toBe("table");
  expect(type("plain text")).toBe("paragraph");
});
