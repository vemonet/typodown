import { expect, test } from "vite-plus/test";
import { parser } from "@lezer/markdown";
import { Math as MathExtension } from "../src/math.ts";

const mdParser = parser.configure([MathExtension]);

/** Collect the names of all top-level and nested nodes in a parsed document. */
function nodeNames(input: string): string[] {
  const tree = mdParser.parse(input);
  const names: string[] = [];
  tree.iterate({ enter: (n) => void names.push(n.name) });
  return names;
}

/** The source text of the first node with the given name, or null. */
function nodeText(input: string, name: string): string | null {
  const tree = mdParser.parse(input);
  let result: string | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.name === name && result === null) result = input.slice(n.from, n.to);
    },
  });
  return result;
}

test("inline math $...$ produces a MathInline node", () => {
  expect(nodeNames("foo $x^2$ bar")).toContain("MathInline");
  expect(nodeText("foo $x^2$ bar", "MathInline")).toBe("$x^2$");
  expect(nodeText("foo $x^2$ bar", "MathInline")?.split("$").length).toBe(3);
});

test("inline $$...$$ (not at line start) is display-mode MathInline", () => {
  expect(nodeNames("text $$x^2$$ end")).toContain("MathInline");
  expect(nodeText("text $$x^2$$ end", "MathInline")).toBe("$$x^2$$");
});

test("block math $$...$$ on a single line produces a MathBlock", () => {
  expect(nodeNames("$$x^2$$")).toContain("MathBlock");
  expect(nodeText("$$x^2$$", "MathBlock")).toBe("$$x^2$$");
});

test("block math $$...$$ spanning multiple lines produces a MathBlock", () => {
  const md = "$$\nx^2 + y^2\n$$";
  expect(nodeNames(md)).toContain("MathBlock");
  expect(nodeText(md, "MathBlock")).toBe(md);
});

test("unmatched $ is left as literal text (no MathInline)", () => {
  expect(nodeNames("it costs $5")).not.toContain("MathInline");
});

test("$$ at the start of a line is a MathBlock, not MathInline", () => {
  const names = nodeNames("$$x^2$$\n$y^2$");
  expect(names).toContain("MathBlock");
  expect(names).toContain("MathInline");
});

test("MathMark nodes are produced for the delimiters", () => {
  expect(nodeNames("$x^2$")).toContain("MathMark");
  expect(nodeNames("$$x^2$$")).toContain("MathMark");
});

test("math inside a blockquote is parsed", () => {
  const md = "> $x^2$\n> $$y^2$$";
  const names = nodeNames(md);
  expect(names).toContain("MathInline");
  expect(names).toContain("MathBlock");
});

test("a paragraph is interrupted by a line starting with $$", () => {
  // Without endLeaf, "$$" would be absorbed into the preceding paragraph
  // and no MathBlock would appear.
  const md = "Some text\n$$x^2$$";
  expect(nodeNames(md)).toContain("MathBlock");
});

test("inline math does not span multiple lines", () => {
  const md = "$a\nb$";
  expect(nodeNames(md)).not.toContain("MathInline");
});
