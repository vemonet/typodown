import { expect, test } from "vite-plus/test";
import { parseOutline } from "../src/outline.ts";

test("parses ATX headings with levels and line numbers", () => {
  expect(parseOutline("# One\n\n## Two\n\n### Three")).toEqual([
    { level: 1, text: "One", line: 1 },
    { level: 2, text: "Two", line: 3 },
    { level: 3, text: "Three", line: 5 },
  ]);
});

test("ignores # inside fenced code blocks", () => {
  const md = "# Real\n\n```\n# not a heading\n```\n\n## After";
  expect(parseOutline(md)).toEqual([
    { level: 1, text: "Real", line: 1 },
    { level: 2, text: "After", line: 7 },
  ]);
});

test("skips leading front matter", () => {
  const md = "---\ntitle: hi\n# not a heading\n---\n\n# Body";
  expect(parseOutline(md)).toEqual([{ level: 1, text: "Body", line: 6 }]);
});

test("recognises setext headings", () => {
  expect(parseOutline("Title\n=====\n\nSub\n---")).toEqual([
    { level: 1, text: "Title", line: 1 },
    { level: 2, text: "Sub", line: 4 },
  ]);
});

test("strips trailing closing hashes and whitespace", () => {
  expect(parseOutline("#   Spaced   #  ")).toEqual([{ level: 1, text: "Spaced", line: 1 }]);
});

test("no headings yields an empty list", () => {
  expect(parseOutline("just a paragraph\nand another")).toEqual([]);
});
