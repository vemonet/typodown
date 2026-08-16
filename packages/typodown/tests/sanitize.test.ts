// @vitest-environment jsdom
// XSS regression tests for the raw-HTML render sinks. DOMPurify needs a DOM.
import { expect, test } from "vite-plus/test";
import { sanitizeHtml } from "../src/sanitize.ts";
import { renderCellHTML } from "../src/live-preview.ts";

// ---- sanitizeHtml: the shared sink used by HtmlWidget and table cells -------

test("strips <script> tags", () => {
  const out = sanitizeHtml("<p>ok</p><script>window.x=1</script>");
  expect(out).not.toContain("<script");
  expect(out).toContain("<p>ok</p>");
});

test("strips inline event-handler attributes", () => {
  // The <img onerror> vector confirmed to execute before the fix.
  const out = sanitizeHtml('<img src="x" onerror="window.x=1">');
  expect(out.toLowerCase()).not.toContain("onerror");
});

test("strips onclick and other handlers on ordinary elements", () => {
  const out = sanitizeHtml('<div onclick="window.x=1">click</div>');
  expect(out.toLowerCase()).not.toContain("onclick");
  expect(out).toContain("click");
});

test("neutralizes javascript: URLs on anchors", () => {
  const out = sanitizeHtml('<a href="javascript:window.x=1">link</a>');
  expect(out.toLowerCase()).not.toContain("javascript:");
});

test("neutralizes data: URLs (data-uri script vector)", () => {
  const out = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  expect(out.toLowerCase()).not.toContain("data:text/html");
});

test("drops <iframe> and <object> embeds", () => {
  expect(sanitizeHtml('<iframe src="https://evil.test"></iframe>').toLowerCase()).not.toContain(
    "<iframe",
  );
  expect(sanitizeHtml('<object data="evil.swf"></object>').toLowerCase()).not.toContain("<object");
});

test("keeps safe formatting HTML intact", () => {
  expect(sanitizeHtml("<b>bold</b>")).toBe("<b>bold</b>");
  expect(sanitizeHtml("<em>i</em>")).toBe("<em>i</em>");
  expect(sanitizeHtml('<a href="https://a.com">x</a>')).toContain('href="https://a.com"');
});

test("resolves relative image sources after sanitizing raw HTML", () => {
  const out = sanitizeHtml(
    '<img src="images/photo one.png" onerror="window.x=1">',
    (src) => `https://local.test/notes/${src.replace(" ", "%20")}`,
  );
  expect(out).toContain('src="https://local.test/notes/images/photo%20one.png"');
  expect(out.toLowerCase()).not.toContain("onerror");
});

// ---- renderCellHTML: table cells go through the same sanitizer --------------

/** True if the HTML, once parsed into the DOM, carries any executable vector:
 * an on* handler attribute, a javascript:/data: URL, or a <script>/<iframe>. A
 * dangerous construct that survives only as escaped text (&lt;...&gt;) is inert
 * and reports false, which is the property we actually care about. */
function hasExecutableVector(html: string): boolean {
  const div = document.createElement("div");
  div.innerHTML = html;
  if (div.querySelector("script, iframe, object, embed")) return true;
  for (const el of div.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.name.toLowerCase().startsWith("on")) return true;
      if (/^\s*(javascript|data|vbscript):/i.test(attr.value)) return true;
    }
  }
  return false;
}

test("table cell with <img onerror> renders inert", () => {
  expect(hasExecutableVector(renderCellHTML('<img src="x" onerror="window.x=1">'))).toBe(false);
});

test("table cell with a javascript: link renders inert", () => {
  expect(hasExecutableVector(renderCellHTML('<a href="javascript:window.x=1">x</a>'))).toBe(false);
});

test("table cell strips <script> but keeps safe HTML", () => {
  expect(renderCellHTML("<b>bold</b>")).toBe("<b>bold</b>");
  expect(hasExecutableVector(renderCellHTML("<script>window.x=1</script>"))).toBe(false);
});

test("table cell resolves Markdown and HTML image sources", () => {
  const resolve = (src: string) => `https://local.test/notes/${src}`;
  expect(renderCellHTML("![alt](photo.png)", resolve)).toContain(
    'src="https://local.test/notes/photo.png"',
  );
  expect(renderCellHTML('<img src="photo.png">', resolve)).toContain(
    'src="https://local.test/notes/photo.png"',
  );
});
