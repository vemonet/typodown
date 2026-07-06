import { expect, test } from "vite-plus/test";
import { matchLanguages, tokenize } from "../src/highlight.ts";

// The editor now delegates document editing, caret, selection and parsing to
// CodeMirror 6, so the behaviours worth unit-testing here are the pure helpers
// it still owns: the fenced-code syntax highlighter and its language matcher.

test("tokenize covers keywords, strings and comments", () => {
  const code = `const x = "hi"; // note`;
  const toks = tokenize(code, "javascript");
  const types = toks.map((t) => t.type);
  expect(types).toContain("keyword");
  expect(types).toContain("string");
  expect(types).toContain("comment");
  // Tokens are ordered and never overlap.
  for (let i = 1; i < toks.length; i++) {
    expect(toks[i]!.from).toBeGreaterThanOrEqual(toks[i - 1]!.to);
  }
});

test("tokenize returns nothing for an unknown language", () => {
  expect(tokenize("some plain text", "not-a-language")).toEqual([]);
});

test("tokenize resolves language aliases", () => {
  expect(tokenize(`def f(): pass`, "py").some((t) => t.type === "keyword")).toBe(true);
});

test("matchLanguages finds by name and alias", () => {
  expect(matchLanguages("java")).toContain("javascript");
  expect(matchLanguages("py")).toContain("python");
  expect(matchLanguages("")).not.toHaveLength(0);
});
