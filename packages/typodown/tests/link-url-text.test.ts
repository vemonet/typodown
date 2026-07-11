import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { typodownMarkdown } from "../src/editor.ts";

// The live-preview `link()` decoration handler must only hide the *destination*
// URL (inside `(...)`), not a URL that is the link's display text. When the
// display text is itself a URL, Lezer parses it as a URL node between `[` and
// `]`; hiding it blanks the link out. These tests pin the tree structure the
// fix relies on: the destination URL is always after the `]` LinkMark.

function linkChildren(doc: string) {
  const s = EditorState.create({ doc, extensions: [typodownMarkdown()] });
  let link: ReturnType<typeof syntaxTree> extends { topNode: infer N } ? N : never;
  syntaxTree(s).iterate({
    enter: (node) => {
      if (node.name === "Link") link = node.node as never;
    },
  });
  const children: { name: string; from: number; to: number; text: string }[] = [];
  for (let c = link!.firstChild; c; c = c.nextSibling) {
    children.push({ name: c.name, from: c.from, to: c.to, text: doc.slice(c.from, c.to) });
  }
  return children;
}

test("link with URL as display text has two URL nodes", () => {
  const doc = "[https://example.com/](https://example.com/)";
  const children = linkChildren(doc);
  const urls = children.filter((c) => c.name === "URL");
  expect(urls).toHaveLength(2);
  // The first URL is the display text (between [ and ]).
  // The second URL is the destination (between ( and )).
  expect(urls[0]!.text).toBe("https://example.com/");
  expect(urls[1]!.text).toBe("https://example.com/");
});

test("the destination URL starts after the ] bracket", () => {
  const doc = "[https://example.com/](https://example.com/)";
  const children = linkChildren(doc);
  const closeBracket = children.find((c) => c.name === "LinkMark" && c.text === "]")!;
  const urls = children.filter((c) => c.name === "URL");
  // Display-text URL is before ]; destination URL is after ].
  expect(urls[0]!.from).toBeLessThan(closeBracket.from);
  expect(urls[1]!.from).toBeGreaterThanOrEqual(closeBracket.to);
});

test("link with plain text has only one URL (the destination)", () => {
  const doc = "[example](https://example.com/)";
  const children = linkChildren(doc);
  const urls = children.filter((c) => c.name === "URL");
  expect(urls).toHaveLength(1);
  expect(urls[0]!.text).toBe("https://example.com/");
});

test("link with www as display text also has two URL nodes", () => {
  const doc = "[www.example.com/](https://example.com/)";
  const children = linkChildren(doc);
  const urls = children.filter((c) => c.name === "URL");
  expect(urls).toHaveLength(2);
});
