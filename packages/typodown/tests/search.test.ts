import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { firstMatchFrom } from "../src/search.ts";

const DOC = "The cat sat on the mat.\nThe end.\n";

/** The query the search panel builds: case-insensitive literal (Typora-style). */
function query(search: string): SearchQuery {
  return new SearchQuery({ search, caseSensitive: false, literal: true });
}

function stateOf(doc = DOC): EditorState {
  return EditorState.create({ doc });
}

/** The cursor yields matches with extra internal fields; compare only the span. */
function span(m: { from: number; to: number } | null): { from: number; to: number } | null {
  return m && { from: m.from, to: m.to };
}

test("finds the first match at or after the caret", () => {
  expect(span(firstMatchFrom(query("the"), stateOf(), 0))).toEqual({ from: 0, to: 3 });
});

test("is case-insensitive", () => {
  // "The" (capital) is matched by the lowercase query.
  const m = firstMatchFrom(query("the"), stateOf(), 0);
  expect(m && DOC.slice(m.from, m.to)).toBe("The");
});

test("advances past a match that starts before the caret", () => {
  // Caret just after the first "The": the next match is the mid-sentence "the".
  expect(span(firstMatchFrom(query("the"), stateOf(), 3))).toEqual({ from: 15, to: 18 });
});

test("wraps around to the top when nothing follows the caret", () => {
  // Caret at the very end: no match after it, so wrap to the first one.
  expect(span(firstMatchFrom(query("the"), stateOf(), DOC.length))).toEqual({ from: 0, to: 3 });
});

test("returns null when the query matches nothing", () => {
  expect(firstMatchFrom(query("zzz"), stateOf(), 0)).toBeNull();
});

test("an empty query matches nothing", () => {
  // Guarded by the caller (commit only searches a non-empty query), but the
  // helper must not throw or return a zero-width match.
  expect(firstMatchFrom(query(""), stateOf(), 0)).toBeNull();
});
