import { expect, test } from "vite-plus/test";
import { taskListLineEdit } from "../src/editor.ts";

// Apply the prefix edit to a line and return the resulting text.
function apply(text: string, off: boolean): string {
  const { from, to, insert } = taskListLineEdit(text, off);
  return text.slice(0, from) + insert + text.slice(to);
}

test("plain line becomes a checkbox", () => {
  expect(apply("hello", false)).toBe("- [ ] hello");
});

test("bullet becomes a checkbox, keeping the content", () => {
  expect(apply("- hello", false)).toBe("- [ ] hello");
});

test("ordered item becomes a bullet checkbox", () => {
  expect(apply("1. hello", false)).toBe("- [ ] hello");
});

test("indent is preserved when making a checkbox", () => {
  expect(apply("  - hello", false)).toBe("  - [ ] hello");
});

test("checked / unchecked box strips back to plain text", () => {
  expect(apply("- [ ] hello", true)).toBe("hello");
  expect(apply("- [x] hello", true)).toBe("hello");
});

test("stripping keeps the leading indent", () => {
  expect(apply("  - [ ] hello", true)).toBe("  hello");
});

test("empty line becomes an empty checkbox", () => {
  expect(apply("", false)).toBe("- [ ] ");
});
