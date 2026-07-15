import { describe, expect, it } from "vite-plus/test";
import { tokenize } from "../src/highlight.ts";

describe("tokenize", () => {
  it("tokenizes a known language", () => {
    const tokens = tokenize('const x = "hi"', "typescript");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.some((t) => t.type === "keyword")).toBe(true);
    expect(tokens.some((t) => t.type === "string")).toBe(true);
  });

  it("returns no tokens for an unknown language", () => {
    expect(tokenize("whatever", "nope")).toEqual([]);
  });

  it("memoizes repeated calls (same array back, no re-parse)", () => {
    const code = "def f():\n    return 42\n";
    const first = tokenize(code, "python");
    expect(tokenize(code, "python")).toBe(first);
    // Alias resolves to the same cache entry as the canonical name.
    expect(tokenize(code, "py")).toBe(first);
  });

  it("caches per language: same code, different lang, different tokens", () => {
    const code = "x = 1 # note";
    expect(tokenize(code, "python")).not.toBe(tokenize(code, "yaml"));
  });
});
