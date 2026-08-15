import { expect, test } from "vite-plus/test";
import {
  buildGraphData,
  extractLinkTargets,
  normalizeId,
  parseFrontmatter,
  resolveTarget,
  type GraphFile,
} from "./graph.ts";

test("extractLinkTargets returns inline link targets, skipping images", () => {
  const md = "See [a](a.md) and [b](<b c.md> 'title'). Not ![img](pic.png).";
  expect(extractLinkTargets(md)).toEqual(["a.md", "b c.md"]);
});

test("parseFrontmatter returns ordered key/value pairs, unquoted, arrays flattened", () => {
  const md = '---\ntype: Articles\ntags: [markdown, "links"]\nauthor: "Ada"\n---\n\n# Body';
  expect(parseFrontmatter(md)).toEqual([
    { key: "type", value: "Articles" },
    { key: "tags", value: "markdown, links" },
    { key: "author", value: "Ada" },
  ]);
  expect(parseFrontmatter("# no front matter")).toEqual([]);
});

test("normalizeId resolves . and .. into a clean posix id", () => {
  expect(normalizeId("./a/b/../c.md")).toBe("a/c.md");
  expect(normalizeId("a//b/")).toBe("a/b");
  expect(normalizeId("\\a\\b.md")).toBe("a/b.md");
});

const IDS = new Set(["index.md", "syntax.md", "advanced/links.md", "advanced/README.md"]);

test("resolveTarget: bare paths are file-relative, leading slash is root-relative", () => {
  // file-relative from a nested file up to the root
  expect(resolveTarget("advanced/links.md", "../index.md", IDS)).toEqual({
    targetId: "index.md",
    missing: false,
  });
  // a bare path is relative to the linking file's folder only (no root fallback):
  // `syntax.md` from a nested file resolves to advanced/syntax.md, not root syntax.md
  expect(resolveTarget("advanced/links.md", "syntax.md", IDS)).toEqual({
    targetId: "advanced/syntax.md",
    missing: true,
  });
  // root-relative leading slash reaches the same file
  expect(resolveTarget("advanced/links.md", "/syntax.md", IDS)).toEqual({
    targetId: "syntax.md",
    missing: false,
  });
  // directory link resolves to its README
  expect(resolveTarget("index.md", "advanced/", IDS)).toEqual({
    targetId: "advanced/README.md",
    missing: false,
  });
  // external + anchor are ignored
  expect(resolveTarget("index.md", "https://example.com", IDS)).toBeNull();
  expect(resolveTarget("index.md", "#section", IDS)).toBeNull();
  // unresolved -> ghost
  expect(resolveTarget("index.md", "gone.md", IDS)).toEqual({
    targetId: "gone.md",
    missing: true,
  });
});

test("buildGraphData produces nodes, edges, and ghost nodes without duplicates", () => {
  const files: GraphFile[] = [
    {
      id: "index.md",
      path: "/v/index.md",
      content: "[b](basics.md) [b again](basics.md) [x](gone.md)",
    },
    { id: "basics.md", path: "/v/basics.md", content: "back to [home](index.md)" },
  ];
  const g = buildGraphData(files);
  expect(g.nodes.find((n) => n.id === "gone.md")?.missing).toBe(true);
  expect(g.nodes.find((n) => n.id === "basics.md")?.missing).toBe(false);
  // duplicate index->basics link collapses to one edge; index->gone and basics->index remain
  expect(g.edges).toEqual([
    { source: "index.md", target: "basics.md" },
    { source: "index.md", target: "gone.md" },
    { source: "basics.md", target: "index.md" },
  ]);
});
