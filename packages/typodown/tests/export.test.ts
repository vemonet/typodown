// @vitest-environment jsdom
// The export pipeline ends in DOMPurify, which needs a DOM.
import { describe, expect, it } from "vite-plus/test";
import { markdownToHtml, markdownToHtmlDocument } from "../src/export.ts";

describe("markdownToHtml", () => {
  it("renders headings with slug anchors", () => {
    const html = markdownToHtml("# Hello World\n\n## Sub Section\n");
    expect(html).toContain('<h1 id="hello-world">Hello World</h1>');
    expect(html).toContain('<h2 id="sub-section">Sub Section</h2>');
  });

  it("renders inline emphasis, code and links", () => {
    const html = markdownToHtml("A **bold** and *it* and `code` and [x](https://e.com).");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://e.com">x</a>');
  });

  it("strips front matter", () => {
    const html = markdownToHtml("---\ntitle: Secret\n---\n\n# Body\n");
    expect(html).not.toContain("Secret");
    expect(html).toContain("Body");
  });

  it("renders bullet and ordered lists, unwrapping tight items", () => {
    const html = markdownToHtml("- one\n- two\n\n1. first\n2. second\n");
    expect(html).toContain("<ul>\n<li>one</li>");
    expect(html).toContain("<ol>\n<li>first</li>");
    expect(html).not.toContain("<li><p>");
  });

  it("honours an ordered list that does not start at 1", () => {
    expect(markdownToHtml("3. three\n4. four\n")).toContain('<ol start="3">');
  });

  it("renders task lists as disabled checkboxes", () => {
    const html = markdownToHtml("- [ ] todo\n- [x] done\n");
    // DOMPurify re-serializes boolean attributes as `disabled=""`.
    expect(html).toContain('<input type="checkbox" disabled=""> todo');
    expect(html).toContain('<input type="checkbox" disabled="" checked=""> done');
  });

  it("renders a GFM table with alignment", () => {
    const html = markdownToHtml("| a | b |\n| :- | -: |\n| 1 | 2 |\n");
    expect(html).toContain("<thead>");
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:right">b</th>');
    expect(html).toContain('<td style="text-align:left">1</td>');
    // The delimiter row must not become a body row.
    expect(html).not.toContain(":-");
  });

  it("renders inline markdown inside table cells", () => {
    const html = markdownToHtml("| a |\n| - |\n| **b** |\n");
    expect(html).toContain("<strong>b</strong>");
  });

  it("highlights fenced code with a known language", () => {
    const html = markdownToHtml("```js\nconst x = 1;\n```\n");
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('<span class="td-tok-keyword">const</span>');
  });

  it("escapes code content and leaves unknown languages plain", () => {
    const html = markdownToHtml("```notalang\n<script>x</script>\n```\n");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders an indented code block", () => {
    expect(markdownToHtml("    indented\n")).toContain("<pre><code>indented");
  });

  it("renders mermaid as an ordinary code block", () => {
    const html = markdownToHtml("```mermaid\ngraph TD;\n```\n");
    expect(html).toContain('class="language-mermaid"');
  });

  it("renders math as visible source rather than dropping it", () => {
    const html = markdownToHtml("$$\nx^2\n$$\n");
    expect(html).toContain('class="td-math"');
    expect(html).toContain("x^2");
  });

  it("renders a plain blockquote", () => {
    const html = markdownToHtml("> quoted\n");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("quoted");
  });

  it("renders a GitHub alert with its label and keeps the body", () => {
    const html = markdownToHtml("> [!WARNING]\n> Be careful here.\n");
    expect(html).toContain('class="td-alert td-alert-warning"');
    expect(html).toContain("Warning</p>");
    expect(html).toContain("Be careful here.");
    expect(html).not.toContain("[!WARNING]");
  });

  it("leaves an unknown bracketed marker as a normal blockquote", () => {
    const html = markdownToHtml("> [!NOPE]\n> body\n");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("td-alert");
  });

  it("numbers footnote references and emits a footnote section", () => {
    const html = markdownToHtml("Text[^a] more[^b].\n\n[^a]: First\n[^b]: Second\n");
    expect(html).toContain('href="#fn-a"');
    expect(html).toContain(">1</a>");
    expect(html).toContain(">2</a>");
    expect(html).toContain('<ol class="td-footnotes">');
    expect(html).toContain("First");
    // The definition lines must not also appear as body paragraphs.
    expect(html).not.toContain("<p>First");
  });

  it("does not treat a bracketed marker inside a code span as a footnote", () => {
    const html = markdownToHtml("Use `[^a]` literally.\n\n[^a]: def\n");
    expect(html).toContain("<code>[^a]</code>");
    expect(html).not.toContain("td-fnref");
  });

  it("omits the footnote section when nothing references a definition", () => {
    const html = markdownToHtml("Body.\n\n[^unused]: never cited\n");
    expect(html).not.toContain("td-footnotes");
  });

  it("sanitizes raw HTML", () => {
    const html = markdownToHtml('<div onclick="evil()">ok</div>\n\n<script>bad()</script>\n');
    expect(html).toContain("ok");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("bad()");
  });

  it("keeps safe raw HTML", () => {
    expect(markdownToHtml("<div><em>kept</em></div>\n")).toContain("<em>kept</em>");
  });

  it("applies resolveImageSrc when given", () => {
    const html = markdownToHtml("![a](pic.png)\n", {
      resolveImageSrc: (src) => `asset://${src}`,
    });
    expect(html).toContain('src="asset://pic.png"');
  });

  it("leaves image paths untouched by default", () => {
    expect(markdownToHtml("![a](sub/pic.png)\n")).toContain('src="sub/pic.png"');
  });

  it("renders a horizontal rule", () => {
    expect(markdownToHtml("a\n\n---\n\nb\n")).toContain("<hr>");
  });
});

describe("markdownToHtmlDocument", () => {
  it("produces a self-contained document with the title and inline styles", () => {
    const doc = markdownToHtmlDocument("# Hi\n", { title: "My Notes" });
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<title>My Notes</title>");
    expect(doc).toContain("<style>");
    expect(doc).toContain("<h1");
    // Self-contained: nothing fetched from the network.
    expect(doc).not.toMatch(/<link[^>]+href=|<script[^>]+src=/);
  });

  it("escapes the title", () => {
    const doc = markdownToHtmlDocument("x", { title: "a <b> & c" });
    expect(doc).toContain("<title>a &lt;b&gt; &amp; c</title>");
  });

  it("falls back to Untitled", () => {
    expect(markdownToHtmlDocument("x", { title: "   " })).toContain("<title>Untitled</title>");
  });
});

describe("regressions", () => {
  it("strips an empty front matter block", () => {
    // This repo's own CONTRIBUTING.md opens with `---\n---`, which used to
    // render as two horizontal rules.
    const html = markdownToHtml("---\n---\n\n# Title\n");
    expect(html).not.toContain("<hr>");
    expect(html).toContain("<h1");
  });

  it("does not emit the alert marker alongside its label", () => {
    // @lezer/common hands out a fresh node wrapper per access, so filtering the
    // marker paragraph out by object identity silently did nothing.
    const html = markdownToHtml("> [!IMPORTANT]\n>\n> Requires a thing.\n");
    expect(html).toContain("Important</p>");
    expect(html).toContain("Requires a thing.");
    expect(html).not.toContain("!IMPORTANT");
  });

  it("keeps body text that shares the marker's paragraph", () => {
    const html = markdownToHtml("> [!NOTE]\n> Same paragraph as the marker.\n");
    expect(html).toContain("Same paragraph as the marker.");
    expect(html).not.toContain("!NOTE");
  });

  it("does not duplicate a nested list inside a task item", () => {
    const html = markdownToHtml("- [ ] parent\n  - child\n");
    expect(html.match(/child/g)?.length).toBe(1);
  });
});
