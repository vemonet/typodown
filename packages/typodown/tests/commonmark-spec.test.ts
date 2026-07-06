import { expect, test } from "vite-plus/test";
import { tests as specTests } from "commonmark-spec";
import { renderHtml } from "./commonmark-html.ts";

// Typodown never renders HTML itself (it's a live-preview overlay on plain
// markdown text), but the fidelity of the parser it's built on, @lezer/
// markdown, configured with the same CommonMark base + GFM bundle as
// ../src/markdown-lang.ts, determines how reliably headings, lists, links
// etc. get recognized under the cursor. commonmark-html.ts renders the
// parser's tree to HTML and this test diffs that against every example in
// the official CommonMark spec, so a parser upgrade (or a change to our own
// extension config) that regresses compatibility gets caught here.
//
// A handful of examples fail for known reasons, see README.md's
// "CommonMark compatibility" section, so this asserts a floor, not 100%.
const MIN_PASS_RATE = 0.93;

test("passes at least the recorded fraction of the CommonMark spec suite", () => {
  let pass = 0;
  const failures: string[] = [];
  for (const { markdown, html, section, number } of specTests) {
    let got: string;
    try {
      got = renderHtml(markdown);
    } catch (error) {
      failures.push(`#${number} (${section}) threw: ${String(error)}`);
      continue;
    }
    if (got === html) pass++;
    else failures.push(`#${number} (${section})`);
  }
  const rate = pass / specTests.length;
  expect(
    rate,
    `${pass}/${specTests.length} passed (${(rate * 100).toFixed(1)}%); ` +
      `first failures: ${failures.slice(0, 5).join(", ")}`,
  ).toBeGreaterThanOrEqual(MIN_PASS_RATE);
});

test("never throws on any spec example", () => {
  for (const { markdown } of specTests) {
    expect(() => renderHtml(markdown)).not.toThrow();
  }
});
